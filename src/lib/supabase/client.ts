import { createBrowserClient } from "@supabase/ssr";
import { readSupabaseCredentials } from "@/lib/supabase/env";

// Browser-side Supabase client. Call inside components/handlers (not at
// module scope) so pages still prerender when env vars are absent.
//
// Returns null when the bundle was built without Supabase credentials, so
// the auth screens can say so plainly instead of failing inside supabase-js.
export function createClientOrNull() {
  const credentials = readSupabaseCredentials();
  if (!credentials) return null;
  return createBrowserClient(credentials.url, credentials.key);
}

export function createClient() {
  const client = createClientOrNull();
  if (!client) {
    throw new Error(
      "Supabase browser client requested without NEXT_PUBLIC_SUPABASE_URL / " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  return client;
}
