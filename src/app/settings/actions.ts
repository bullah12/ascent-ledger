"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WEIGHTS, type RecommenderWeights } from "@/lib/recommender";
import { parseSuggestionSettings } from "@/lib/suggestion-settings";

export async function saveWeights(formData: FormData): Promise<void> {
  const user = await requireUser();

  const weights: RecommenderWeights = { ...DEFAULT_WEIGHTS };
  for (const key of ["w1", "w2", "w3", "w4"] as const) {
    const value = Number(formData.get(key));
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      weights[key] = value;
    }
  }

  const tags = await prisma.tag.findMany({ select: { slug: true } });
  const suggestions = parseSuggestionSettings(
    formData,
    new Set(tags.map((tag) => tag.slug))
  );
  const displayName = (() => {
    const value = formData.get("displayName");
    return typeof value === "string" ? value.trim().slice(0, 80) || null : null;
  })();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { recommenderWeightsJson: weights, displayName },
    }),
    prisma.userPreference.update({
      where: { userId: user.id },
      data: {
        preferredDisciplines: suggestions.preferredDisciplines,
        preferredRegions: suggestions.preferredRegions,
        preferredTagSlugs: suggestions.preferredTagSlugs,
        gradeWindowsJson: suggestions.gradeWindows,
        maxTripLengthDays: suggestions.maxTripLengthDays,
        exploreLevel: suggestions.exploreLevel,
        suggestionWeightsJson: suggestions.weights,
      },
    }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath("/map");
  revalidatePath("/for-you");
  redirect("/dashboard");
}
