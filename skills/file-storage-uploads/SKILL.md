---
name: file-storage-uploads
description: Storing and serving user-uploaded files — images and documents. Covers upload flow, S3-compatible object storage, image variants, validation, and a files metadata table.
used-by: [ecommerce-platform, trail-social-app, property-management, photo-dedupe-tool]
---

# Skill: File Storage & Uploads

## Purpose

One pattern for every file a user gives us: product photos, trail photos,
lease PDFs, expense receipts. Files live in object storage; Postgres stores
metadata; the app never serves bytes from its own disk.

## When to Use

- Any feature accepting uploads (images, PDFs, receipts).
- Generating files server-side (contracts from `pdf-document-generation`) —
  store them through this same pattern.
- Photo-dedupe tool: reads from local folders instead of object storage, but
  reuses the metadata-table idea (hashes, dimensions, paths).

## Inputs

- File types and max sizes per feature (decide and write into the spec).
- Public vs private: product images are public; leases and receipts are private.

## Outputs

- A `files` table (below) + per-domain link tables or FK columns.
- Upload endpoint(s) implementing the presigned-upload flow.
- Image variant generation (thumbnails) for image-heavy features.

## Default Stack

| Concern | Default | Notes |
|---|---|---|
| Object storage | S3-compatible: AWS S3 in prod, **MinIO** in docker-compose for dev | Same SDK both places |
| SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | |
| Image processing | `sharp` | Resize on upload, not on request |
| Serving public files | CDN/base-URL in front of the bucket | Never proxy bytes through the API |
| Serving private files | Short-lived presigned GET URLs (5–15 min) | API authorizes, storage serves |

## Upload Flow (presigned, default)

1. Client: `POST /api/v1/uploads` with `{ filename, contentType, sizeBytes, purpose }`.
2. Server validates type/size against the `purpose` policy, creates a `files`
   row with `status='pending'`, returns `{ fileId, uploadUrl }` (presigned PUT).
3. Client PUTs bytes directly to storage.
4. Client: `POST /api/v1/uploads/:fileId/complete`. Server verifies the
   object exists (HEAD), checks real size/type, sets `status='ready'`,
   kicks off variant generation for images.
5. Feature endpoints accept `fileId` references only for `status='ready'`
   files owned by the caller.

Small internal tools (property management) may use simple multipart upload
through the API instead — same `files` table, same validation.

## Core Schema

```sql
CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose      text NOT NULL,          -- 'product-image' | 'trail-photo' | 'lease-doc' | 'receipt'
  storage_key  text NOT NULL UNIQUE,   -- '<purpose>/<uuid>/<sanitized-name>'
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL,
  checksum_sha256 text,
  is_public    boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  variants     jsonb NOT NULL DEFAULT '{}',  -- { "thumb": "key", "md": "key" }
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

Domain tables reference files by FK (`product_images(product_id, file_id, sort_order)`,
`contracts.document_file_id`).

## Validation Rules

- Allow-list content types per purpose; verify **magic bytes**, not just the
  header (`file-type` package).
- Enforce max size per purpose (e.g. images 10 MB, PDFs 25 MB).
- Strip EXIF GPS from user photos unless the feature needs it (trail app
  may keep it, with user consent, for trail geotagging).
- Sanitize filenames; the storage key is server-generated, never the raw name.
- Re-encode images with `sharp` on variant generation — this also neutralizes
  most malformed-image attacks.

## Image Variants

Generate at upload time: `thumb` (200px), `md` (800px), `lg` (1600px), WebP.
Store keys in `files.variants`. Product/trail listing pages must only ever
load `thumb`/`md`.

## Best Practices

- Buckets are private by default; "public" means served via CDN path, not a
  public bucket ACL.
- Orphan cleanup: nightly job deletes `status='pending'` files older than 24h
  (see `notifications-scheduling` skill for the job runner).
- Deleting a domain object soft-deletes; a background job hard-deletes storage
  objects after the retention window.
- Never trust client-reported size/type after upload — HEAD the object.
- Keep `checksum_sha256`: it enables exact-duplicate detection (and is the
  first pass of the photo-dedupe pipeline).

## Used By

- **ecommerce-platform** — product images (public, variants).
- **trail-social-app** — trail photos, avatars (public, variants, EXIF care).
- **property-management** — lease PDFs, certificates, receipts (private, presigned GET).
- **photo-dedupe-tool** — local-disk variant: same metadata columns (path, checksum, dimensions) in its local DB.
