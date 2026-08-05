import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { failurePath, safeNext } from "../redirect-target";

// Token-hash confirmation: used if the Supabase email template is switched
// to the SSR-recommended {{ .TokenHash }} form. Complements /auth/callback.
// A recovery template should point here with type=recovery and
// next=/reset-password.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(
    searchParams.get("next"),
    // A recovery token only proves the address; it should land on the page
    // that sets a new password, not the dashboard.
    searchParams.get("type") === "recovery" ? "/reset-password" : "/dashboard"
  );

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}${failurePath(next)}`);
}
