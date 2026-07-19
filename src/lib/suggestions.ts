import type { PrismaClient } from "@/generated/prisma/client";
import type { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { gradeLabelForScore } from "@/lib/grades";
import { normaliseText } from "@/lib/matching";
import {
  clamp01,
  haversineKm,
  proximityScore,
  ratingScore,
  recencyWeight,
  roundScore,
} from "@/lib/scoring";

export type SuggestionWeights = {
  gradeComfort: number;
  disciplineAffinity: number;
  familiarity: number;
  explicitPreferences: number;
  preferredTags: number;
  quality: number;
  tripFit: number;
  distancePenalty: number;
};

export const DEFAULT_SUGGESTION_WEIGHTS: SuggestionWeights = {
  gradeComfort: 2.5,
  disciplineAffinity: 1,
  familiarity: 1.5,
  explicitPreferences: 2,
  preferredTags: 1.5,
  quality: 1,
  tripFit: 0.5,
  distancePenalty: 0.5,
};

export type GradeWindow = { min: number; max: number };

export type SuggestionPreferences = {
  preferredDisciplines: Discipline[];
  preferredRegions: string[];
  preferredTagSlugs: string[];
  gradeWindows: Partial<Record<GradeSystem, GradeWindow>>;
  maxTripLengthDays: number | null;
  exploreLevel: number;
  weights: SuggestionWeights;
};

export type SuggestionHistory = {
  routeId: string | null;
  routeName: string;
  discipline: Discipline;
  date: Date;
  gradeSystem: GradeSystem | null;
  gradeScore: number | null;
  area: string | null;
  region: string | null;
  tagSlugs: string[];
  lat: number | null;
  lng: number | null;
};

export type SuggestionCandidate = {
  id: string;
  name: string;
  discipline: Discipline;
  gradeSystem: GradeSystem | null;
  gradeRaw: string | null;
  gradeScore: number | null;
  areaName: string | null;
  region: string | null;
  country: string | null;
  tagSlugs: string[];
  lengthM: number | null;
  pitches: number | null;
  lat: number | null;
  lng: number | null;
  avgRating: number | null;
  qualityRating: number | null;
};

export type GradeComfortBand = {
  low: number;
  high: number;
  provisional: boolean;
};

export type AffinityProfile = {
  discipline: Map<Discipline, number>;
  areas: Map<string, number>;
  regions: Map<string, number>;
  tags: Map<string, number>;
  gradeBands: Map<GradeSystem, GradeComfortBand>;
  visitedCoords: { lat: number; lng: number }[];
};

export type SuggestionTerms = {
  gradeComfort: number;
  disciplineAffinity: number;
  familiarity: number;
  explicitPreferences: number;
  preferredTags: number;
  quality: number;
  tripFit: number;
  distancePenalty: number;
};

export type ForYouSuggestion = {
  routeId: string;
  name: string;
  discipline: Discipline;
  gradeRaw: string | null;
  areaName: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  score: number;
  why: string;
  terms: SuggestionTerms;
};

function add(map: Map<string, number>, key: string | null, weight: number) {
  if (!key) return;
  const normalised = normaliseText(key);
  if (normalised) map.set(normalised, (map.get(normalised) ?? 0) + weight);
}

function normaliseMap<T>(map: Map<T, number>): Map<T, number> {
  const maximum = Math.max(0, ...map.values());
  if (maximum === 0) return map;
  return new Map([...map].map(([key, value]) => [key, clamp01(value / maximum)]));
}

function weightedQuantile(
  values: { value: number; weight: number }[],
  quantile: number
): number {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const target = sorted.reduce((sum, item) => sum + item.weight, 0) * quantile;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.value;
  }
  return sorted.at(-1)?.value ?? 0;
}

export function parseSuggestionWeights(json: unknown): SuggestionWeights {
  if (!json || typeof json !== "object") return DEFAULT_SUGGESTION_WEIGHTS;
  const raw = json as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(DEFAULT_SUGGESTION_WEIGHTS).map(([key, fallback]) => {
      const value = raw[key];
      return [key, typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback];
    })
  ) as SuggestionWeights;
}

export function parseGradeWindows(json: unknown): Partial<Record<GradeSystem, GradeWindow>> {
  if (!json || typeof json !== "object") return {};
  const windows: Partial<Record<GradeSystem, GradeWindow>> = {};
  for (const [system, value] of Object.entries(json as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { min, max } = value as { min?: unknown; max?: unknown };
    if (
      typeof min === "number" &&
      typeof max === "number" &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min <= max
    ) {
      windows[system as GradeSystem] = { min, max };
    }
  }
  return windows;
}

export function buildAffinityProfile(
  history: SuggestionHistory[],
  now: Date,
  provisionalGradesJson: unknown = null
): AffinityProfile {
  const discipline = new Map<Discipline, number>();
  const areas = new Map<string, number>();
  const regions = new Map<string, number>();
  const tags = new Map<string, number>();
  const grades = new Map<GradeSystem, { value: number; weight: number }[]>();
  const visitedCoords: { lat: number; lng: number }[] = [];

  for (const climb of history) {
    const weight = recencyWeight(climb.date, now);
    discipline.set(climb.discipline, (discipline.get(climb.discipline) ?? 0) + weight);
    add(areas, climb.area, weight);
    add(regions, climb.region, weight);
    for (const tag of climb.tagSlugs) add(tags, tag, weight);
    if (climb.gradeSystem && climb.gradeScore !== null) {
      const values = grades.get(climb.gradeSystem) ?? [];
      values.push({ value: climb.gradeScore, weight });
      grades.set(climb.gradeSystem, values);
    }
    if (climb.lat !== null && climb.lng !== null) {
      visitedCoords.push({ lat: climb.lat, lng: climb.lng });
    }
  }

  const gradeBands = new Map<GradeSystem, GradeComfortBand>();
  for (const [system, values] of grades) {
    gradeBands.set(system, {
      low: weightedQuantile(values, 0.25),
      high: weightedQuantile(values, 0.75),
      provisional: false,
    });
  }
  if (provisionalGradesJson && typeof provisionalGradesJson === "object") {
    for (const [system, score] of Object.entries(provisionalGradesJson as Record<string, unknown>)) {
      if (!gradeBands.has(system as GradeSystem) && typeof score === "number" && Number.isFinite(score)) {
        gradeBands.set(system as GradeSystem, { low: score, high: score, provisional: true });
      }
    }
  }

  return {
    discipline: normaliseMap(discipline),
    areas: normaliseMap(areas),
    regions: normaliseMap(regions),
    tags: normaliseMap(tags),
    gradeBands,
    visitedCoords,
  };
}

export function estimateTripDays(candidate: Pick<SuggestionCandidate, "lengthM" | "pitches">): number {
  if (candidate.lengthM && candidate.lengthM > 0) return Math.max(1, Math.ceil(candidate.lengthM / 25_000));
  if (candidate.pitches && candidate.pitches > 0) return Math.max(1, Math.ceil(candidate.pitches / 8));
  return 1;
}

function matchesRegion(candidate: SuggestionCandidate, regions: string[]): boolean {
  if (regions.length === 0) return true;
  const haystack = normaliseText(
    [candidate.areaName, candidate.region, candidate.country].filter(Boolean).join(" ")
  );
  if (!haystack) return false;
  return regions.some((region) => {
    const needle = normaliseText(region);
    return Boolean(needle && (haystack.includes(needle) || needle.includes(haystack)));
  });
}

function isEligible(candidate: SuggestionCandidate, preferences: SuggestionPreferences): boolean {
  if (
    preferences.preferredDisciplines.length > 0 &&
    !preferences.preferredDisciplines.includes(candidate.discipline)
  ) return false;
  if (!matchesRegion(candidate, preferences.preferredRegions)) return false;
  if (
    preferences.maxTripLengthDays !== null &&
    estimateTripDays(candidate) > preferences.maxTripLengthDays
  ) return false;
  if (candidate.gradeSystem && preferences.gradeWindows[candidate.gradeSystem]) {
    const window = preferences.gradeWindows[candidate.gradeSystem]!;
    if (
      candidate.gradeScore === null ||
      candidate.gradeScore < window.min ||
      candidate.gradeScore > window.max
    ) return false;
  }
  return true;
}

function gradeComfort(candidate: SuggestionCandidate, profile: AffinityProfile): number {
  if (!candidate.gradeSystem || candidate.gradeScore === null) return 0.5;
  const band = profile.gradeBands.get(candidate.gradeSystem);
  if (!band) return 0.5;
  if (candidate.gradeScore >= band.low && candidate.gradeScore <= band.high) return 1;
  const edge = candidate.gradeScore < band.low ? band.low : band.high;
  return proximityScore(candidate.gradeScore, edge, 4);
}

function average(values: number[]): number {
  return values.length === 0 ? 0.5 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function candidateTerms(
  candidate: SuggestionCandidate,
  profile: AffinityProfile,
  preferences: SuggestionPreferences
): SuggestionTerms {
  const areaAffinity = candidate.areaName
    ? profile.areas.get(normaliseText(candidate.areaName)) ?? 0
    : 0;
  const regionAffinity = candidate.region
    ? profile.regions.get(normaliseText(candidate.region)) ?? 0
    : 0;
  const tagAffinities = candidate.tagSlugs.map((slug) => profile.tags.get(normaliseText(slug)) ?? 0);
  const familiarSignals = [areaAffinity, regionAffinity, ...tagAffinities];
  const familiarBase = familiarSignals.some((value) => value > 0)
    ? familiarSignals.reduce((sum, value) => sum + value, 0) / familiarSignals.length
    : 0;
  const familiarity = clamp01(
    (1 - preferences.exploreLevel) * familiarBase +
      preferences.exploreLevel * (1 - familiarBase)
  );
  const explicitSignals: number[] = [];
  if (preferences.preferredDisciplines.length > 0) explicitSignals.push(1);
  if (preferences.preferredRegions.length > 0) explicitSignals.push(1);
  const preferredTags =
    preferences.preferredTagSlugs.length === 0
      ? 0.5
      : candidate.tagSlugs.filter((slug) => preferences.preferredTagSlugs.includes(slug)).length /
        preferences.preferredTagSlugs.length;
  const qualityRating = candidate.avgRating ?? candidate.qualityRating;
  const days = estimateTripDays(candidate);
  const tripFit = preferences.maxTripLengthDays
    ? clamp01(1 - (days - 1) / preferences.maxTripLengthDays)
    : 0.5;
  let distancePenalty = 0;
  if (candidate.lat !== null && candidate.lng !== null && profile.visitedCoords.length > 0) {
    const nearest = Math.min(
      ...profile.visitedCoords.map((point) =>
        haversineKm(point, { lat: candidate.lat!, lng: candidate.lng! })
      )
    );
    distancePenalty = clamp01(nearest / 500);
  }
  return {
    gradeComfort: gradeComfort(candidate, profile),
    disciplineAffinity: profile.discipline.get(candidate.discipline) ?? 0.5,
    familiarity,
    explicitPreferences: average(explicitSignals),
    preferredTags,
    quality: ratingScore(qualityRating),
    tripFit,
    distancePenalty,
  };
}

function explanation(
  candidate: SuggestionCandidate,
  terms: SuggestionTerms,
  profile: AffinityProfile,
  preferences: SuggestionPreferences
): string {
  const band = candidate.gradeSystem ? profile.gradeBands.get(candidate.gradeSystem) : null;
  const preferredMatches = candidate.tagSlugs.filter((tag) =>
    preferences.preferredTagSlugs.includes(tag)
  ).length;
  const reasons = [
    {
      value: terms.gradeComfort * preferences.weights.gradeComfort,
      text: band && candidate.gradeSystem
        ? band.provisional
          ? `fits your provisional ${gradeLabelForScore(candidate.gradeSystem, band.low) ?? "grade"} level`
          : `fits your recent ${gradeLabelForScore(candidate.gradeSystem, band.low) ?? band.low}–${gradeLabelForScore(candidate.gradeSystem, band.high) ?? band.high} comfort band`
        : "has an approachable grade fit",
    },
    {
      value: terms.explicitPreferences * preferences.weights.explicitPreferences,
      text: "matches your discipline and region preferences",
    },
    {
      value: terms.preferredTags * preferences.weights.preferredTags,
      text: preferredMatches > 0
        ? `matches ${preferredMatches} preferred tag${preferredMatches === 1 ? "" : "s"}`
        : "matches your tag preferences",
    },
    {
      value: terms.familiarity * preferences.weights.familiarity,
      text: preferences.exploreLevel > 0.5 ? "adds some novelty" : "matches familiar areas or terrain",
    },
    {
      value: terms.quality * preferences.weights.quality,
      text: candidate.avgRating !== null
        ? `well rated by the community (${candidate.avgRating.toFixed(1)}/5)`
        : candidate.qualityRating !== null
          ? `well rated by its source (${candidate.qualityRating}/5)`
          : "has a neutral quality signal",
    },
    {
      value: terms.tripFit * preferences.weights.tripFit,
      text: `fits a roughly ${estimateTripDays(candidate)}-day trip`,
    },
  ];
  return reasons
    .sort((a, b) => b.value - a.value || a.text.localeCompare(b.text))
    .filter((reason) => reason.value > 0)
    .slice(0, 2)
    .map((reason) => reason.text)
    .join("; ") || "matches your saved preferences";
}

export function scoreCandidateRoutes(
  candidates: SuggestionCandidate[],
  history: SuggestionHistory[],
  preferences: SuggestionPreferences,
  now: Date,
  provisionalGradesJson: unknown = null
): ForYouSuggestion[] {
  const profile = buildAffinityProfile(history, now, provisionalGradesJson);
  const completedIds = new Set(history.map((item) => item.routeId).filter(Boolean));
  const completedNames = new Set(history.map((item) => normaliseText(item.routeName)));
  const positiveWeight =
    preferences.weights.gradeComfort +
    preferences.weights.disciplineAffinity +
    preferences.weights.familiarity +
    preferences.weights.explicitPreferences +
    preferences.weights.preferredTags +
    preferences.weights.quality +
    preferences.weights.tripFit;
  const denominator = positiveWeight + preferences.weights.distancePenalty || 1;

  return candidates
    .filter(
      (candidate) =>
        !completedIds.has(candidate.id) &&
        !completedNames.has(normaliseText(candidate.name)) &&
        isEligible(candidate, preferences)
    )
    .map((candidate) => {
      const terms = candidateTerms(candidate, profile, preferences);
      const positive =
        terms.gradeComfort * preferences.weights.gradeComfort +
        terms.disciplineAffinity * preferences.weights.disciplineAffinity +
        terms.familiarity * preferences.weights.familiarity +
        terms.explicitPreferences * preferences.weights.explicitPreferences +
        terms.preferredTags * preferences.weights.preferredTags +
        terms.quality * preferences.weights.quality +
        terms.tripFit * preferences.weights.tripFit;
      const score = clamp01(
        (positive - terms.distancePenalty * preferences.weights.distancePenalty) /
          denominator
      );
      return {
        routeId: candidate.id,
        name: candidate.name,
        discipline: candidate.discipline,
        gradeRaw: candidate.gradeRaw,
        areaName: candidate.areaName,
        region: candidate.region,
        lat: candidate.lat,
        lng: candidate.lng,
        score: roundScore(score),
        why: explanation(candidate, terms, profile, preferences),
        terms,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.name.localeCompare(b.name) || a.routeId.localeCompare(b.routeId)
    );
}

export async function getForYouSuggestions(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
  limit = 30
): Promise<ForYouSuggestion[]> {
  const [preference, climbs, routes] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.climb.findMany({
      where: { userId },
      select: {
        routeId: true,
        freeTextRouteName: true,
        discipline: true,
        date: true,
        gradeSystem: true,
        gradeNormalisedScore: true,
        area: { select: { name: true, region: true, lat: true, lng: true } },
        route: {
          select: {
            lat: true,
            lng: true,
            area: { select: { name: true, region: true } },
            routeTags: { select: { tag: { select: { slug: true } } } },
          },
        },
      },
    }),
    prisma.route.findMany({
      select: {
        id: true,
        name: true,
        discipline: true,
        gradeSystem: true,
        gradeRaw: true,
        gradeNormalisedScore: true,
        lengthM: true,
        pitches: true,
        lat: true,
        lng: true,
        avgRating: true,
        qualityRating: true,
        area: { select: { name: true, region: true, country: true } },
        routeTags: { select: { tag: { select: { slug: true } } } },
      },
    }),
  ]);
  if (!preference) return [];

  const history: SuggestionHistory[] = climbs.map((climb) => ({
    routeId: climb.routeId,
    routeName: climb.freeTextRouteName,
    discipline: climb.discipline,
    date: climb.date,
    gradeSystem: climb.gradeSystem,
    gradeScore: climb.gradeNormalisedScore,
    area: climb.area?.name ?? climb.route?.area?.name ?? null,
    region: climb.area?.region ?? climb.route?.area?.region ?? null,
    tagSlugs: climb.route?.routeTags.map((assignment) => assignment.tag.slug) ?? [],
    lat: climb.route?.lat ?? climb.area?.lat ?? null,
    lng: climb.route?.lng ?? climb.area?.lng ?? null,
  }));
  const candidates: SuggestionCandidate[] = routes.map((route) => ({
    id: route.id,
    name: route.name,
    discipline: route.discipline,
    gradeSystem: route.gradeSystem,
    gradeRaw: route.gradeRaw,
    gradeScore: route.gradeNormalisedScore,
    areaName: route.area?.name ?? null,
    region: route.area?.region ?? null,
    country: route.area?.country ?? null,
    tagSlugs: route.routeTags.map((assignment) => assignment.tag.slug),
    lengthM: route.lengthM,
    pitches: route.pitches,
    lat: route.lat,
    lng: route.lng,
    avgRating: route.avgRating,
    qualityRating: route.qualityRating,
  }));
  const preferences: SuggestionPreferences = {
    preferredDisciplines: preference.preferredDisciplines,
    preferredRegions: preference.preferredRegions,
    preferredTagSlugs: preference.preferredTagSlugs,
    gradeWindows: parseGradeWindows(preference.gradeWindowsJson),
    maxTripLengthDays: preference.maxTripLengthDays,
    exploreLevel: clamp01(preference.exploreLevel),
    weights: parseSuggestionWeights(preference.suggestionWeightsJson),
  };
  return scoreCandidateRoutes(
    candidates,
    history,
    preferences,
    now,
    preference.provisionalGradesJson
  ).slice(0, limit);
}
