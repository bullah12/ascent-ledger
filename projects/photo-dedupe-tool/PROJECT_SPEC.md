# PROJECT SPEC — Photo Dedupe Tool

A small, local, single-user tool: point it at folders of photos, it finds
exact and near-duplicates (checksums → perceptual hashes → CLIP embeddings +
cosine similarity), and gives you a review UI to keep/delete. **It never
deletes anything without explicit confirmation.**

## Shared Skills Applied

| Skill | How it's used here |
|---|---|
| `embeddings-similarity-search` | The core: the full "dedupe ladder" (SHA-256 → pHash → CLIP), clustering, thresholds |
| `file-storage-uploads` | Local-disk variant: same metadata ideas (checksum, dimensions, content type) in the local DB |
| `database-schema-design` | Naming conventions apply; SQLite instead of Postgres (zero-setup exception noted in the skill) |
| `rest-api-design` | Only if the review UI is web-based (local HTTP API follows the same conventions) |

**Stack exception (per the embeddings skill):** Python end-to-end —
`open_clip` (ViT-B/32), `imagehash`, `Pillow`, SQLite, NumPy brute-force
cosine (fine to ~200k photos; `faiss` beyond). CLI via `typer`; review UI as
a local web page (`FastAPI` + a single-page UI) — richer than a terminal UI
for comparing images side by side.

## Data Model (SQLite)

```
photos           id, path unique, size_bytes, checksum_sha256,
                 width, height, taken_at (EXIF) NULL, camera_model NULL,
                 phash (64-bit hex), embedding blob NULL, embedding_model text,
                 status CHECK(indexed|missing|deleted),
                 scanned_at, created_at
scan_roots       id, path unique, last_scanned_at, include_glob, exclude_glob
dupe_groups      id, kind CHECK(exact|near|similar), created_run_id,
                 status CHECK(pending|reviewed|dismissed)
dupe_group_members  group_id FK, photo_id FK, similarity_to_keeper real,
                    suggested_keeper boolean, decision CHECK(keep|delete|undecided)
runs             id, started_at, finished_at, params jsonb (thresholds, model),
                 stats jsonb (files seen, groups found)
actions_log      id, run_id, photo_id, action CHECK(trashed|restored), acted_at,
                 trash_path   -- where the file went, for undo
```

Embeddings cached by `checksum_sha256` — moved/renamed files re-link instead
of re-embedding (per the skill's caching rule).

## Pipeline

```
scan → hash → embed → group → review → act
```

1. **Scan:** walk `scan_roots`, upsert `photos` rows (new/changed by
   mtime+size), mark vanished files `missing`.
2. **Hash:** SHA-256 (exact dupes, free) + pHash. Group byte-identical files
   immediately (`kind='exact'`).
3. **Embed:** batch CLIP embeddings for photos lacking one (skip anything
   already resolved as an exact dupe).
4. **Group:** pHash Hamming ≤ 5 and/or cosine ≥ 0.96 → edges; union-find →
   `dupe_groups` (`near`); 0.90–0.96 → `similar` groups (bursts, crops).
   Suggested keeper per the skill heuristic: resolution → file size → earliest
   EXIF date.
5. **Review (web UI):** review-queue pattern — one group at a time, photos
   side by side (zoom/sync-pan), keeper pre-selected, keyboard shortcuts
   (space = toggle, K = keeper, enter = confirm group), similarity scores shown.
6. **Act:** confirmed deletions move files to a tool-managed trash folder
   (`~/.photo-dedupe/trash/<run>/…`) recorded in `actions_log`; **Undo**
   restores; a separate explicit "empty trash" actually frees space.

## CLI Surface

```
photo-dedupe scan ~/Pictures /mnt/backup --exclude "*.raw"
photo-dedupe run --near-threshold 0.96 --phash-distance 5
photo-dedupe review          # opens the local web UI
photo-dedupe apply           # move confirmed deletes to trash
photo-dedupe undo <run-id>   # restore from trash
photo-dedupe stats           # dupes found, space reclaimable
```

## Assumptions & Notes

- JPEG/PNG/HEIC/WebP in v1; RAW files listed but only checksum-matched
  (no pHash/CLIP) until a RAW decoder is added.
- Thresholds are config with the skill's defaults; first run reports the
  score distribution so they can be tuned (per the skill's evaluation advice).
- Videos out of scope. Cloud photo libraries out of scope (local folders only).
- Possible future: reuse the embedding pipeline for "search my photos by
  text" (CLIP text encoder) — free capability once embeddings exist.
