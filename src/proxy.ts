import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session handling (Next.js 16 proxy, formerly middleware): refreshes the
// Supabase auth token on every matched request and keeps request/response
// cookies in sync. Also gates /dashboard behind a session.
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase env vars (e.g. fresh clone), skip auth handling
  // entirely instead of crashing every request.
  if (!supabaseUrl || !supabaseKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: do not run other logic between createServerClient and
  // auth.getUser() — it can cause hard-to-debug session bugs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPrefixes = ["/dashboard", "/logbook", "/routes", "/map"];
  if (
    !user &&
    protectedPrefixes.some((prefix) =>
      request.nextUrl.pathname.startsWith(prefix)
    )
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
