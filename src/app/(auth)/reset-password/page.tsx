import { ResetPasswordForm } from "./reset-password-form";

// Public route: no server-side session check. The recovery credentials arrive
// in the URL (a PKCE `?code=`, a `#access_token=` fragment, or a
// `?token_hash=`), and a fragment never reaches the server — so the page
// renders unconditionally and the client component establishes the session
// from the URL before deciding whether there is anything to reset.
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
