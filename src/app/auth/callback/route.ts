import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PKCE callback: Supabase redirects here with ?code= after email
// confirmation (default email template) or OAuth. Exchanges the code for a
// session cookie, then sends the user on.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/sign-in?error=Could+not+verify+your+email.+Please+try+again.`
  );
}
