import type { PrismaClient } from "@/generated/prisma/client";
import { evaluateProgress, type CategoryProgress } from "@/lib/bmg/engine";
import {
  getSuggestions,
  parseWeights,
  type CategorySuggestions,
} from "@/lib/recommender";

// One-stop evaluation for a user: BMG progress (Phase 2 engine) plus route
// suggestions for the unmet rules (Phase 5 recommender). Used by the
// dashboard and the map so both always agree.
export async function getUserProgressAndSuggestions(
  prisma: PrismaClient,
  user: { id: string; recommenderWeightsJson: unknown }
): Promise<{
  hasRules: boolean;
  progress: CategoryProgress[];
  hasUnverified: boolean;
  categorySuggestions: CategorySuggestions[];
}> {
  const [categories, climbs, preference] = await Promise.all([
    prisma.bmgCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { rules: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.climb.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        discipline: true,
        date: true,
        ascentStyle: true,
        gradeSystem: true,
        gradeRaw: true,
        gradeNormalisedScore: true,
        area: { select: { id: true, name: true, region: true, country: true } },
      },
    }),
    prisma.userPreference.findUnique({
      where: { userId: user.id },
      select: { provisionalGradesJson: true },
    }),
  ]);

  const progress = evaluateProgress(categories, climbs);

  const metByRuleId = new Map(
    progress.flatMap((c) => c.rules.map((r) => [r.id, r.met] as const))
  );
  const categorySuggestions = await getSuggestions(
    prisma,
    user.id,
    categories.map((category) => ({
      key: category.key,
      rules: category.rules.map((rule) => ({
        id: rule.id,
        gradeSystem: rule.gradeSystem,
        minGradeNormalisedScore: rule.minGradeNormalisedScore,
        extraConstraintJson: rule.extraConstraintJson,
        met: metByRuleId.get(rule.id) ?? false,
      })),
    })),
    parseWeights(user.recommenderWeightsJson),
    preference?.provisionalGradesJson
  );

  return {
    hasRules: categories.length > 0,
    progress,
    hasUnverified: categories.some((c) => c.rules.some((r) => !r.verified)),
    categorySuggestions,
  };
}
