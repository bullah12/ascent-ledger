import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabaseCredentials } from "@/lib/supabase/env";

// Server-side Supabase client bound to the current request's cookies.
// Create a fresh client per request — never store it in a module global.
export async function createClient() {
  const cookieStore = await cookies();
  const credentials = readSupabaseCredentials();

  if (!credentials) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy."
    );
  }

  return createServerClient(
    credentials.url,
    credentials.key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Safe to ignore: the proxy (src/proxy.ts) refreshes sessions.
          }
        },
      },
    }
  );
}
