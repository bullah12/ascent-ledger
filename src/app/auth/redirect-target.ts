// `next` comes from the query string of an emailed link, so it can be
// anything. Only same-origin absolute paths are forwarded to; "//evil.com"
// and "https://evil.com" would otherwise leave the site with a freshly
// minted session cookie in hand.
export function safeNext(next: string | null, fallback = "/dashboard") {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

/** Where a failed confirmation should land, given where it was headed. */
export function failurePath(next: string) {
  if (next.startsWith("/reset-password")) {
    return (
      "/forgot-password?error=" +
      encodeURIComponent(
        "That reset link has expired or was already used. Request a new one."
      )
    );
  }
  return (
    "/sign-in?error=" +
    encodeURIComponent("Could not verify your email. Please try again.")
  );
}
