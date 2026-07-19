"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseOnboardingForm, persistOnboardingPreferences } from "@/lib/preferences";

export type OnboardingState = { error?: string };

export async function completeOnboarding(
  _state: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const user = await requireUser();
  const parsed = parseOnboardingForm(formData);
  if (!parsed.success) return { error: parsed.error };
  await persistOnboardingPreferences(prisma, user.id, parsed.data);
  redirect("/dashboard");
}
