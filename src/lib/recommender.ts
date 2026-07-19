import type { PrismaClient } from "@/generated/prisma/client";
import type { Discipline, GradeSystem } from "@/generated/prisma/enums";
import {
  areaMatchesRegions,
  effectiveGrade,
  type EngineClimb,
} from "@/lib/bmg/engine";
import { gradeLabelForScore, gradeSystemsByDiscipline } from "@/lib/grades";
import { normaliseText } from "@/lib/matching";
import {
  haversineKm,
  proximityScore,
  ratingScore,
  roundScore,
} from "@/lib/scoring";

// Rule-based route recommender (PLAN.md §6 — no ML, deliberately simple
// and debuggable). For each unmet BMG sub-rule:
//
//   candidates = routes of the rule's discipline
//     · grade within [current_max − 1, current_max + 2] in the rule's system
//     · matching the rule's region constraints
//     · not already logged by the user
//
//   score = w1·grade_fit + w2·quality + w3·area_diversity − w4·distance_penalty
//
// Every component is normalised to 0..1 before weighting, so weights are
// directly comparable; w1–w4 are editable per user in /settings.

export type RecommenderWeights = {
  /** Grade fit: closer to "one step above your current max" scores higher. */
  w1: number;
  /** Quality: prefer well-regarded routes where the source rates them. */
  w2: number;
  /** Area diversity: slight preference for areas you haven't climbed in. */
  w3: number;
  /** Distance penalty: prefer routes near areas you've already visited. */
  w4: number;
};

export const DEFAULT_WEIGHTS: RecommenderWeights = {
  w1: 3,
  w2: 1,
  w3: 0.5,
  w4: 0.5,
};

export function parseWeights(json: unknown): RecommenderWeights {
  if (!json || typeof json !== "object") return DEFAULT_WEIGHTS;
  const raw = json as Record<string, unknown>;
  const weight = (key: keyof RecommenderWeights) => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : DEFAULT_WEIGHTS[key];
  };
  return { w1: weight("w1"), w2: weight("w2"), w3: weight("w3"), w4: weight("w4") };
}

export type RouteSuggestion = {
  routeId: string;
  name: string;
  gradeRaw: string | null;
  areaName: string | null;
  externalUrl: string | null;
  lat: number | null;
  lng: number | null;
  score: number;
  /** One-line human explanation of the dominant scoring reason. */
  why: string;
};

export type RuleSuggestions = {
  ruleId: string;
  suggestions: RouteSuggestion[];
};

export type CategorySuggestions = {
  categoryKey: Discipline;
  rules: RuleSuggestions[];
};

type CandidateRoute = {
  id: string;
  name: string;
  discipline: Discipline;
  gradeSystem: GradeSystem | null;
  gradeRaw: string | null;
  gradeNormalisedScore: number | null;
  lat: number | null;
  lng: number | null;
  qualityRating: number | null;
  externalUrl: string | null;
  area: { id: string; name: string; region: string | null; country: string | null } | null;
};

type RuleForRec = {
  id: string;
  gradeSystem: GradeSystem | null;
  minGradeNormalisedScore: number | null;
  extraConstraintJson: unknown;
  met: boolean;
};

const GRADE_WINDOW_BELOW = 1;
const GRADE_WINDOW_ABOVE = 2;
const DISTANCE_NORM_KM = 500; // penalty saturates at this distance
const TOP_N = 5;

/** User's best normalised score in one grade system, from their climbs. */
function currentMaxScore(
  climbs: EngineClimb[],
  discipline: Discipline,
  system: GradeSystem
): number | null {
  let max: number | null = null;
  for (const climb of climbs) {
    if (climb.discipline !== discipline) continue;
    const grade = effectiveGrade(climb);
    if (grade && grade.system === system && (max === null || grade.score > max)) {
      max = grade.score;
    }
  }
  return max;
}

export function provisionalGradeScore(json: unknown, system: GradeSystem): number | null {
  if (!json || typeof json !== "object") return null;
  const value = (json as Record<string, unknown>)[system];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Real history always wins; provisional onboarding grades are cold-start only. */
export function resolveGradeAnchor(
  climbs: EngineClimb[],
  discipline: Discipline,
  system: GradeSystem,
  provisionalGradesJson: unknown
): { score: number | null; provisional: boolean } {
  const real = currentMaxScore(climbs, discipline, system);
  if (real !== null) return { score: real, provisional: false };
  const provisional = provisionalGradeScore(provisionalGradesJson, system);
  return { score: provisional, provisional: provisional !== null };
}

function recommendForRule(
  rule: RuleForRec,
  discipline: Discipline,
  routes: CandidateRoute[],
  climbs: EngineClimb[],
  context: {
    loggedRouteIds: Set<string>;
    loggedNames: Set<string>;
    visitedAreaKeys: Set<string>;
    visitedCoords: { lat: number; lng: number }[];
  },
  weights: RecommenderWeights,
  provisionalGradesJson: unknown
): RouteSuggestion[] {
  // The grade window is anchored on the user's current max in the rule's
  // grade system ("just above your comfortable grade", §6). For rules
  // without a grade threshold, the discipline's default system is used;
  // with no graded climbs at all, the rule threshold anchors instead.
  const system =
    rule.gradeSystem ?? gradeSystemsByDiscipline[discipline][0];
  const resolvedAnchor = resolveGradeAnchor(
    climbs,
    discipline,
    system,
    provisionalGradesJson
  );
  const currentMax = resolvedAnchor.provisional ? null : resolvedAnchor.score;
  const anchor = resolvedAnchor.score ?? rule.minGradeNormalisedScore;

  const constraint =
    rule.extraConstraintJson && typeof rule.extraConstraintJson === "object"
      ? (rule.extraConstraintJson as { regions?: string[]; region?: string })
      : {};
  const regionList =
    constraint.regions ?? (constraint.region ? [constraint.region] : null);

  const scored: RouteSuggestion[] = [];

  for (const route of routes) {
    if (route.discipline !== discipline) continue;
    if (context.loggedRouteIds.has(route.id)) continue;
    if (context.loggedNames.has(normaliseText(route.name))) continue;
    if (regionList && !areaMatchesRegions(route.area, regionList)) continue;

    // Grade window filter — only applicable when we have an anchor and the
    // route is graded in the rule's system.
    let gradeFit = 0.5; // neutral when no grade information exists
    if (anchor !== null) {
      if (route.gradeSystem !== system || route.gradeNormalisedScore === null) {
        continue;
      }
      const s = route.gradeNormalisedScore;
      if (s < anchor - GRADE_WINDOW_BELOW || s > anchor + GRADE_WINDOW_ABOVE) {
        continue;
      }
      // Best fit = one step above current max ("next logical grade").
      const target = resolvedAnchor.score !== null ? resolvedAnchor.score + 1 : anchor;
      gradeFit = proximityScore(s, target, GRADE_WINDOW_ABOVE + 1);
    }

    const quality = ratingScore(route.qualityRating);

    const areaKey = route.area
      ? normaliseText(route.area.name)
      : null;
    const diversity = areaKey && !context.visitedAreaKeys.has(areaKey) ? 1 : 0;

    let distancePenalty = 0;
    let nearestKm: number | null = null;
    if (route.lat !== null && route.lng !== null && context.visitedCoords.length > 0) {
      nearestKm = Math.min(
        ...context.visitedCoords.map((c) =>
          haversineKm(c, { lat: route.lat!, lng: route.lng! })
        )
      );
      distancePenalty = Math.min(nearestKm / DISTANCE_NORM_KM, 1);
    }

    const score =
      weights.w1 * gradeFit +
      weights.w2 * quality +
      weights.w3 * diversity -
      weights.w4 * distancePenalty;

    scored.push({
      routeId: route.id,
      name: route.name,
      gradeRaw: route.gradeRaw,
      areaName: route.area?.name ?? null,
      externalUrl: route.externalUrl,
      lat: route.lat,
      lng: route.lng,
      score: roundScore(score),
      why: whyLine({
        gradeFit,
        quality,
        diversity,
        nearestKm,
        route,
        system,
        currentMax,
        provisionalAnchor: resolvedAnchor.provisional ? resolvedAnchor.score : null,
      }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_N);
}

function whyLine(input: {
  gradeFit: number;
  quality: number;
  diversity: number;
  nearestKm: number | null;
  route: CandidateRoute;
  system: GradeSystem;
  currentMax: number | null;
  provisionalAnchor: number | null;
}): string {
  const { route, system, currentMax } = input;
  const parts: string[] = [];

  if (currentMax !== null && route.gradeNormalisedScore !== null) {
    const maxLabel = gradeLabelForScore(system, currentMax) ?? "your max";
    const delta = route.gradeNormalisedScore - currentMax;
    if (delta === 1) parts.push(`one grade step up from your current ${maxLabel} max`);
    else if (delta > 1) parts.push(`${delta} grade steps above your current ${maxLabel} max`);
    else if (delta === 0) parts.push(`at your current ${maxLabel} level`);
    else parts.push(`consolidates below your ${maxLabel} max`);
  } else if (input.provisionalAnchor !== null) {
    const label = gradeLabelForScore(system, input.provisionalAnchor) ?? "reported";
    parts.push(`based on your provisional ${label} level`);
  } else if (route.gradeRaw) {
    parts.push(`at the rule's target grade (${route.gradeRaw})`);
  }

  if (input.quality >= 0.75 && route.qualityRating !== null) {
    parts.push(`well regarded (${route.qualityRating}/5)`);
  }
  if (input.diversity === 1 && route.area) {
    parts.push(`new area for you (${route.area.name})`);
  } else if (input.nearestKm !== null && input.nearestKm <= 50) {
    parts.push(`~${Math.round(input.nearestKm)} km from where you've climbed`);
  }

  return parts.slice(0, 2).join("; ") || "matches this rule's gap";
}

/**
 * Top-N suggestions per unmet rule, per category. `ruleResults` comes from
 * the Phase 2 engine so met rules are skipped without re-deriving them.
 */
export async function getSuggestions(
  prisma: PrismaClient,
  userId: string,
  categories: {
    key: Discipline;
    rules: (RuleForRec & { discipline?: never })[];
  }[],
  weights: RecommenderWeights,
  provisionalGradesJson: unknown = null
): Promise<CategorySuggestions[]> {
  const [routes, climbs] = await Promise.all([
    prisma.route.findMany({
      select: {
        id: true,
        name: true,
        discipline: true,
        gradeSystem: true,
        gradeRaw: true,
        gradeNormalisedScore: true,
        lat: true,
        lng: true,
        qualityRating: true,
        externalUrl: true,
        area: { select: { id: true, name: true, region: true, country: true } },
      },
    }),
    prisma.climb.findMany({
      where: { userId },
      select: {
        id: true,
        discipline: true,
        date: true,
        ascentStyle: true,
        freeTextRouteName: true,
        gradeSystem: true,
        gradeRaw: true,
        gradeNormalisedScore: true,
        routeId: true,
        route: { select: { lat: true, lng: true } },
        area: { select: { id: true, name: true, region: true, country: true } },
      },
    }),
  ]);

  const loggedRouteIds = new Set(
    climbs.map((c) => c.routeId).filter((id): id is string => id !== null)
  );
  const loggedNames = new Set(
    climbs.map((c) => normaliseText(c.freeTextRouteName)).filter(Boolean)
  );
  const visitedAreaKeys = new Set(
    climbs
      .map((c) => (c.area ? normaliseText(c.area.name) : null))
      .filter((k): k is string => k !== null)
  );
  const visitedCoords = climbs
    .map((c) => c.route)
    .filter((r): r is { lat: number; lng: number } =>
      r !== null && r.lat !== null && r.lng !== null
    );

  const context = { loggedRouteIds, loggedNames, visitedAreaKeys, visitedCoords };

  return categories.map((category) => ({
    categoryKey: category.key,
    rules: category.rules
      .filter((rule) => !rule.met)
      .map((rule) => ({
        ruleId: rule.id,
        suggestions: recommendForRule(
          rule,
          category.key,
          routes,
          climbs,
          context,
          weights,
          provisionalGradesJson
        ),
      })),
  }));
}
