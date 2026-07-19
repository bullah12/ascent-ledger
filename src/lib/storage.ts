import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase Storage uploads for climb attachments. Requires two PUBLIC
// buckets in the Supabase project (Dashboard → Storage): "climb-photos"
// and "gpx-tracks", each with an INSERT/DELETE policy for authenticated
// users on paths starting with their own auth.uid(). Files are stored at
// <userId>/<random>.<ext> and referenced by public URL on the Climb row.

export const PHOTOS_BUCKET = "climb-photos";
// Kept under the existing bucket name so Phase 6 GPX URLs remain valid; the
// bucket now accepts both GPX and KML raw source files.
export const TRACKS_BUCKET = "gpx-tracks";
export const GPX_BUCKET = TRACKS_BUCKET;

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_CLIMB = 8;
export const MAX_TRACK_BYTES = 5 * 1024 * 1024;
export const MAX_GPX_BYTES = MAX_TRACK_BYTES;

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

async function upload(
  supabase: SupabaseClient,
  bucket: string,
  userId: string,
  file: File,
  ext: string,
  contentType: string
): Promise<UploadResult> {
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType, upsert: false });
  if (error) {
    return {
      ok: false,
      error: `Upload failed (${error.message}). Check the "${bucket}" storage bucket exists and allows uploads.`,
    };
  }
  return { ok: true, url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}

export async function uploadClimbPhoto(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<UploadResult> {
  const ext = PHOTO_TYPES[file.type];
  if (!ext) {
    return { ok: false, error: `Unsupported photo type ${file.type || "unknown"} (use JPEG/PNG/WebP/AVIF)` };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: `Photo "${file.name}" is over 5 MB` };
  }
  return upload(supabase, PHOTOS_BUCKET, userId, file, ext, file.type);
}

export async function uploadTrackFile(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<UploadResult> {
  const lower = file.name.toLowerCase();
  const format = lower.endsWith(".gpx") ? "gpx" : lower.endsWith(".kml") ? "kml" : null;
  if (!format) return { ok: false, error: "Track file must be GPX or KML" };
  if (file.size > MAX_TRACK_BYTES) return { ok: false, error: "Track file is over 5 MB" };
  const contentType =
    format === "gpx" ? "application/gpx+xml" : "application/vnd.google-earth.kml+xml";
  return upload(supabase, TRACKS_BUCKET, userId, file, format, contentType);
}

/** Backwards-compatible name for callers outside this workspace. */
export const uploadGpxTrack = uploadTrackFile;

/** Best-effort delete of previously uploaded files by public URL — a failed
 *  delete only leaks an orphaned file, never blocks the user's save. */
export async function removeStoredFiles(
  supabase: SupabaseClient,
  bucket: string,
  urls: string[]
): Promise<void> {
  const marker = `/object/public/${bucket}/`;
  const paths = urls
    .map((url) => {
      const index = url.indexOf(marker);
      return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length));
    })
    .filter((p): p is string => p !== null);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(bucket).remove(paths);
  } catch {
    // Orphaned file — acceptable.
  }
}
