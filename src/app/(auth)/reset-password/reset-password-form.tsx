"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClientOrNull } from "@/lib/supabase/client";
import { SUPABASE_CONFIG_ERROR } from "@/lib/supabase/env";
import { describeAuthError } from "../auth-errors";
import {
  PASSWORD_MIN_LENGTH,
  RECOVERY_LINK_ERROR,
  describePasswordPairProblem,
} from "../password-rules";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** How long the success message stays up before the redirect to /login. */
const SUCCESS_PAUSE_MS = 1500;

// Supabase reports a dead link by redirecting back with error details — in
// the query string or in the fragment, depending on the flow.
function readLinkError(): string | null {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const read = (name: string) => query.get(name) ?? fragment.get(name);

  const code = read("error_code");
  const error = read("error");
  const description = read("error_description");
  if (!code && !error && !description) return null;

  // otp_expired / access_denied are the ordinary "too old or already used"
  // cases; anything else is worth showing as Supabase worded it.
  if (code === "otp_expired" || error === "access_denied") {
    return RECOVERY_LINK_ERROR;
  }
  return description?.replace(/\+/g, " ") ?? RECOVERY_LINK_ERROR;
}

type Status = "checking" | "ready" | "invalid" | "saved";

export function ResetPasswordForm() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const [status, setStatus] = useState<Status>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function establishSession() {
      const client = createClientOrNull();
      if (!client) return { session: null, message: SUPABASE_CONFIG_ERROR };
      supabaseRef.current = client;

      const linkError = readLinkError();
      if (linkError) return { session: null, message: linkError };

      // A `{{ .TokenHash }}` email template lands here with the token in the
      // query string; that one has to be redeemed explicitly.
      const tokenHash = new URLSearchParams(window.location.search).get(
        "token_hash"
      );
      if (tokenHash) {
        const { error } = await client.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });
        if (error) return { session: null, message: describeAuthError(error) };
      }

      // getSession() resolves only once the client has finished processing
      // whatever the recovery URL carried (the PKCE `?code=`, or the
      // `#access_token=` fragment), so the answer below already accounts for
      // the link. It must not be a bare "is someone logged in?" check made
      // before that work happens.
      const {
        data: { session },
      } = await client.auth.getSession();
      return { session, message: session ? null : RECOVERY_LINK_ERROR };
    }

    establishSession().then(({ session, message }) => {
      if (!active) return;
      if (!session) {
        setError(message);
        setStatus("invalid");
        return;
      }
      setEmail(session.user.email ?? "");
      setStatus("ready");
    });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const problem = describePasswordPairProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    const supabase = supabaseRef.current;
    if (!supabase) {
      setError(SUPABASE_CONFIG_ERROR);
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(describeAuthError(error));
      setSaving(false);
      return;
    }

    // The recovery link signed them in; end that one-time session so the new
    // password is what gets them back in.
    await supabase.auth.signOut();
    setStatus("saved");
    setSaving(false);
    setTimeout(() => {
      router.push("/login");
      router.refresh();
    }, SUCCESS_PAUSE_MS);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {status === "saved"
              ? "Password updated"
              : status === "invalid"
                ? "Reset link no longer valid"
                : "Choose a new password"}
          </CardTitle>
          <CardDescription>
            {status === "invalid"
              ? "This reset link can no longer be used."
              : status === "saved"
                ? "You can sign in with your new password now."
                : email
                  ? `Resetting the password for ${email}.`
                  : "Your new password replaces the old one everywhere."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "checking" && (
            <p className="text-sm text-muted-foreground">
              Checking your reset link…
            </p>
          )}

          {status === "invalid" && (
            <div className="grid gap-4">
              <p className="text-sm text-destructive" role="alert">
                {error ?? RECOVERY_LINK_ERROR}
              </p>
              <Button render={<Link href="/forgot-password" />}>
                Request another reset email
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/sign-in" className="underline underline-offset-4">
                  Back to sign in
                </Link>
              </p>
            </div>
          )}

          {status === "saved" && (
            <div className="grid gap-4">
              <p className="text-sm text-primary" role="status">
                Your password has been changed. Taking you to the sign-in page…
              </p>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="underline underline-offset-4">
                  Sign in now
                </Link>
              </p>
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least {PASSWORD_MIN_LENGTH} characters, including a letter
                  and a number.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmation">Confirm password</Label>
                <Input
                  id="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
