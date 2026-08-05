"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClientOrNull } from "@/lib/supabase/client";

export const RESET_PASSWORD_PATH = "/reset-password";

// A recovery link started from the Supabase Users dashboard ignores our
// redirectTo and uses the project's Site URL, so the credentials can land on
// any page. Wherever that is, supabase-js parses them and fires
// PASSWORD_RECOVERY — take the visitor to the page that can use them.
export function AuthRecoveryListener() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClientOrNull();
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // Read the location rather than usePathname() so the subscription is
      // set up once and never goes stale between navigations.
      if (
        event === "PASSWORD_RECOVERY" &&
        window.location.pathname !== RESET_PASSWORD_PATH
      ) {
        router.replace(RESET_PASSWORD_PATH);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
