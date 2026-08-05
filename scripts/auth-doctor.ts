import "dotenv/config";

// Checks the Supabase Auth side of the app without touching the database:
// are credentials present, is the project reachable, does it accept our API
// key, and is email/password sign-up actually enabled?
//
//   npm run auth:doctor
//
// Reads the same variables the browser bundle uses, so a failure here is a
// failure the sign-in page would also hit.

type Settings = {
  external?: Record<string, boolean>;
  disable_signup?: boolean;
  mailer_autoconfirm?: boolean;
};

const ok = (message: string) => console.log(`  ok    ${message}`);
const warn = (message: string) => console.log(`  warn  ${message}`);
const fail = (message: string) => console.log(`  FAIL  ${message}`);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  console.log("Supabase auth check\n");

  if (!url || !key) {
    fail(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not both " +
        "set in this environment (.env locally, project settings when deployed)."
    );
    process.exitCode = 1;
    return;
  }
  ok(`project URL ${url}`);

  const keyKind = key.startsWith("sb_publishable_")
    ? "publishable key"
    : key.startsWith("eyJ")
      ? "legacy JWT anon key"
      : "unrecognised key format";
  ok(`API key looks like a ${keyKind}`);
  if (keyKind === "unrecognised key format") {
    warn(
      "Expected either `sb_publishable_...` or a JWT starting `eyJ`. Copy the " +
        "value from Project Settings → API Keys."
    );
  }

  let health: Response;
  try {
    health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
  } catch (error) {
    fail(
      `could not reach ${url} (${(error as Error).message}). The project may ` +
        "be paused — free projects pause after a period of inactivity and " +
        "must be resumed from the dashboard."
    );
    process.exitCode = 1;
    return;
  }

  if (health.status === 401 || health.status === 403) {
    fail(
      "the project rejected this API key (HTTP " +
        health.status +
        "). If legacy JWT keys were disabled or rotated, copy the current " +
        "publishable key from Project Settings → API Keys and redeploy."
    );
    process.exitCode = 1;
    return;
  }
  if (!health.ok) {
    fail(`GET /auth/v1/health returned HTTP ${health.status}`);
    process.exitCode = 1;
    return;
  }
  ok("auth service is up and accepted the API key");

  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
  });
  if (!response.ok) {
    warn(`GET /auth/v1/settings returned HTTP ${response.status}`);
    return;
  }

  const settings = (await response.json()) as Settings;

  if (settings.external?.email === false) {
    fail(
      "the Email provider is disabled — password sign-in and sign-up cannot " +
        "work. Enable it in Authentication → Sign In / Providers."
    );
    process.exitCode = 1;
  } else {
    ok("email provider is enabled");
  }

  if (settings.disable_signup) {
    fail(
      "new sign-ups are disabled for this project (Authentication → Sign In / " +
        "Providers → Allow new users to sign up)."
    );
    process.exitCode = 1;
  } else {
    ok("new sign-ups are allowed");
  }

  if (settings.mailer_autoconfirm) {
    ok("email confirmation is off — new accounts can sign in immediately");
  } else {
    ok(
      "email confirmation is required — a new account cannot sign in until " +
        "the emailed link is opened"
    );
    warn(
      "the built-in email sender is rate-limited to a few messages per hour; " +
        "configure custom SMTP if confirmation emails are not arriving"
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
