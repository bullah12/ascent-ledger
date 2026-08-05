import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { failurePath, safeNext } from "../redirect-target";

// PKCE callback: Supabase redirects here with ?code= after email
// confirmation (default email template), password recovery, or OAuth.
// Exchanges the code for a session cookie, then sends the user on.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}${failurePath(next)}`);
}
