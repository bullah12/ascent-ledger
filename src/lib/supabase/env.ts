// Single place that reads the Supabase browser-safe credentials.
//
// Two things make a missing/stale value here hard to spot in production:
// NEXT_PUBLIC_* variables are inlined into the browser bundle at *build*
// time (so adding them in the host's dashboard does nothing until the next
// deploy), and Supabase now issues publishable keys (`sb_publishable_...`)
// alongside the legacy JWT anon key. Read both names, and report the
// problem instead of handing `undefined` to the Supabase client.

export type SupabaseCredentials = { url: string; key: string };

export function readSupabaseCredentials(): SupabaseCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // The publishable key replaces the legacy anon key; either is accepted as
  // the browser-safe credential.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;
  return { url, key };
}

/** Message shown in the auth UI when the app was built without credentials. */
export const SUPABASE_CONFIG_ERROR =
  "This app is not configured to reach Supabase (missing " +
  "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Because these " +
  "are baked in at build time, set them in your hosting environment and " +
  "redeploy.";
