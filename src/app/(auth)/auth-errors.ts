import type { AuthError } from "@supabase/supabase-js";

// Supabase auth failures arrive as a short message plus a `code`/`status`.
// Several distinct project-level problems ("the anon key no longer works",
// "the project is paused", "email sign-ins are switched off") otherwise look
// like an ordinary wrong-password to the person typing, so name them.
export function describeAuthError(error: AuthError): string {
  const code = error.code ?? "";
  const message = error.message ?? "";

  // supabase-js reports a failed fetch with status 0 and no code: the
  // project URL is unreachable — wrong URL, or a paused/deleted project.
  if (
    code === "" &&
    (error.status === 0 || /fetch|network/i.test(message))
  ) {
    return (
      "Could not reach the Supabase project. It may be paused (free projects " +
      "pause after a period of inactivity) or NEXT_PUBLIC_SUPABASE_URL may be " +
      "wrong. Check the project status in the Supabase dashboard."
    );
  }

  if (/invalid api key|no api key/i.test(message)) {
    return (
      "Supabase rejected this app's API key. If the project's legacy JWT keys " +
      "were disabled or rotated, copy the current publishable key from " +
      "Project Settings → API Keys into NEXT_PUBLIC_SUPABASE_ANON_KEY and redeploy."
    );
  }

  switch (code) {
    case "invalid_credentials":
      return (
        "That email and password combination was not accepted. If the account " +
        "exists, reset the password from the Supabase dashboard or use a " +
        "password reset email."
      );
    case "email_not_confirmed":
      return (
        "This email address has not been confirmed yet. Open the confirmation " +
        "link sent when the account was created, or resend it from the " +
        "Supabase dashboard."
      );
    case "signup_disabled":
      return (
        "New sign-ups are turned off for this project. Enable them in " +
        "Supabase → Authentication → Sign In / Providers."
      );
    case "email_provider_disabled":
      return (
        "Email and password sign-in is disabled for this project. Re-enable " +
        "the Email provider in Supabase → Authentication → Sign In / Providers."
      );
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return (
        "Supabase is rate-limiting this project (the built-in email sender " +
        "allows only a few messages per hour). Wait and try again, or " +
        "configure custom SMTP."
      );
    case "user_already_exists":
    case "email_exists":
      return "An account already exists for this email — sign in instead.";
    case "weak_password":
      return `That password was rejected: ${message}`;
    default:
      return message || "Authentication failed.";
  }
}
