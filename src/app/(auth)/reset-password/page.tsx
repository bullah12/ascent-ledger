import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Reached from the emailed recovery link via /auth/callback (or
// /auth/confirm), which exchanges the one-time token for a session first.
// Without that session there is nothing to update, so send the visitor back
// to request a fresh link rather than showing a form that cannot work.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/forgot-password?error=" +
        encodeURIComponent(
          "That reset link has expired or was already used. Request a new one."
        )
    );
  }

  return <ResetPasswordForm email={user.email ?? ""} />;
}
