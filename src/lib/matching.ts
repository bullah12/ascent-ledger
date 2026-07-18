import type { PrismaClient } from "@/generated/prisma/client";

// Fuzzy matching between free-text Climb entries and canonical Routes,
// by name + area. Matches become ClimbRouteSuggestion rows the user
// accepts or rejects in the logbook — never auto-linked. Rejected pairs
// are kept so they don't resurface on the next sync.

export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

/** Sørensen–Dice similarity on character bigrams, with shortcuts for exact
 *  and substring matches. Returns 0–1. */
export function similarity(a: string, b: string): number {
  const left = normaliseText(a);
  const right = normaliseText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (
    (left.length >= 4 && right.includes(left)) ||
    (right.length >= 4 && left.includes(right))
  ) {
    return 0.9;
  }
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;
  let shared = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) shared++;
  }
  return (2 * shared) / (leftGrams.size + rightGrams.size);
}

const MIN_NAME_SIMILARITY = 0.7;
const MIN_SCORE = 0.78;
const NEUTRAL_AREA_FACTOR = 0.75; // when either side has no area recorded
const MAX_SUGGESTIONS_PER_CLIMB = 3;

export function matchScore(
  climb: { name: string; areaName: string | null },
  route: { name: string; areaName: string | null }
): number | null {
  const nameSim = similarity(climb.name, route.name);
  if (nameSim < MIN_NAME_SIMILARITY) return null;

  const areaFactor =
    climb.areaName && route.areaName
      ? similarity(climb.areaName, route.areaName)
      : NEUTRAL_AREA_FACTOR;

  const score = 0.75 * nameSim + 0.25 * areaFactor;
  return score >= MIN_SCORE ? score : null;
}

/**
 * Creates pending ClimbRouteSuggestion rows for unlinked climbs that
 * plausibly match a Route (same discipline, similar name, compatible
 * area). Pairs that already have a suggestion in any status are skipped.
 * Returns the number of new suggestions.
 */
export async function generateLinkSuggestions(
  prisma: PrismaClient
): Promise<number> {
  const [climbs, routes, existing] = await Promise.all([
    prisma.climb.findMany({
      where: { routeId: null },
      select: {
        id: true,
        discipline: true,
        freeTextRouteName: true,
        area: { select: { name: true } },
      },
    }),
    prisma.route.findMany({
      select: {
        id: true,
        discipline: true,
        name: true,
        area: { select: { name: true } },
      },
    }),
    prisma.climbRouteSuggestion.findMany({
      select: { climbId: true, routeId: true },
    }),
  ]);

  const seen = new Set(existing.map((s) => `${s.climbId}:${s.routeId}`));
  const toCreate: { climbId: string; routeId: string; score: number }[] = [];

  for (const climb of climbs) {
    const candidates: { routeId: string; score: number }[] = [];
    for (const route of routes) {
      if (route.discipline !== climb.discipline) continue;
      if (seen.has(`${climb.id}:${route.id}`)) continue;
      const score = matchScore(
        { name: climb.freeTextRouteName, areaName: climb.area?.name ?? null },
        { name: route.name, areaName: route.area?.name ?? null }
      );
      if (score !== null) candidates.push({ routeId: route.id, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates.slice(0, MAX_SUGGESTIONS_PER_CLIMB)) {
      toCreate.push({
        climbId: climb.id,
        routeId: candidate.routeId,
        score: Math.round(candidate.score * 1000) / 1000,
      });
    }
  }

  if (toCreate.length === 0) return 0;
  const { count } = await prisma.climbRouteSuggestion.createMany({
    data: toCreate,
    skipDuplicates: true,
  });
  return count;
}
