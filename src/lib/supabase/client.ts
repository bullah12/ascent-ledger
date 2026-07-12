import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Call inside components/handlers (not at
// module scope) so pages still prerender when env vars are absent.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
