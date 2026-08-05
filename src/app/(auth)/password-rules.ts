// Rules applied to a password the visitor is choosing (sign-up, recovery).
// Supabase enforces its own minimum server-side; checking here first turns a
// round trip into an inline message.

export const PASSWORD_MIN_LENGTH = 8;

/** Returns a problem to show, or null when the password is acceptable. */
export function describePasswordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}

/** Returns a problem with the pair, or null when they match and are valid. */
export function describePasswordPairProblem(
  password: string,
  confirmation: string
): string | null {
  if (password !== confirmation) return "The two passwords do not match.";
  return describePasswordProblem(password);
}

/** Shown when a recovery link carries no usable credentials any more. */
export const RECOVERY_LINK_ERROR =
  "That reset link has expired or was already used. Request a new one and " +
  "open it on this device.";
