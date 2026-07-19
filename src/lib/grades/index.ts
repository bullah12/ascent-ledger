import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import ladders from "./grade_ladders.json";

// Grade normalisation (PLAN.md §3): one ordinal ladder per grade system, no
// cross-system conversion. A score answers "is this at/above threshold X"
// within its own system only.

export type LadderEntry = { score: number; label: string; aliases: string[] };
export type GradeLadder = { label: string; _note?: string; entries: LadderEntry[] };

const gradeLadders = ladders as unknown as Record<GradeSystem, GradeLadder>;

export function gradeLadder(system: GradeSystem): GradeLadder {
  return gradeLadders[system];
}

export const gradeSystemLabels: Record<GradeSystem, string> = {
  uk_trad: "UK trad",
  french_sport: "French sport",
  uiaa: "UIAA",
  scottish_winter: "Scottish winter",
  wi_ice: "Water ice (WI)",
  alpine_overall: "Alpine overall",
  ski_touring_scale: "Ski touring",
  sac_hiking: "SAC hiking",
};

// Grade systems offered per discipline (first entry = form default).
export const gradeSystemsByDiscipline: Record<Discipline, GradeSystem[]> = {
  rock: [GradeSystem.uk_trad, GradeSystem.french_sport, GradeSystem.uiaa],
  winter: [GradeSystem.scottish_winter, GradeSystem.wi_ice],
  alpine: [GradeSystem.alpine_overall],
  ski_touring: [GradeSystem.ski_touring_scale],
  hiking: [GradeSystem.sac_hiking],
};

// A grade string matches a ladder entry when one of the entry's aliases is
// the whole string or a prefix ending at a boundary (space, comma, slash,
// dot, open paren). Longest alias wins, so "VI,7" is VI not V, and "E1 5b"
// is E1. Uppercased and whitespace-collapsed before matching.
function normaliseRaw(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

const BOUNDARY = /[\s,/.()]/;

function aliasMatches(candidate: string, alias: string): boolean {
  if (!candidate.startsWith(alias)) return false;
  if (candidate.length === alias.length) return true;
  return BOUNDARY.test(candidate[alias.length]);
}

/**
 * Ordinal score of a raw grade string within its grade system's ladder, or
 * null when the string doesn't parse (shown as "ungraded" downstream —
 * never an error).
 */
export function normaliseGrade(
  system: GradeSystem,
  raw: string
): number | null {
  const ladder = gradeLadders[system];
  if (!ladder || ladder.entries.length === 0) return null;

  const candidate = normaliseRaw(raw);
  if (!candidate) return null;

  let best: { score: number; aliasLength: number } | null = null;
  for (const entry of ladder.entries) {
    for (const alias of entry.aliases) {
      if (
        aliasMatches(candidate, alias) &&
        (!best || alias.length > best.aliasLength)
      ) {
        best = { score: entry.score, aliasLength: alias.length };
      }
    }
  }
  return best?.score ?? null;
}

/** Canonical label for a score in a system (e.g. 13 in alpine_overall → "TD"). */
export function gradeLabelForScore(
  system: GradeSystem,
  score: number
): string | null {
  const entry = gradeLadders[system]?.entries.find((e) => e.score === score);
  return entry?.label ?? null;
}

/**
 * Best-effort score for a climb that predates the grade engine (Phase 1
 * rows have no grade_system): try the discipline's systems in order and
 * return the first parse that succeeds.
 */
export function inferGrade(
  discipline: Discipline,
  raw: string
): { system: GradeSystem; score: number } | null {
  for (const system of gradeSystemsByDiscipline[discipline]) {
    const score = normaliseGrade(system, raw);
    if (score !== null) return { system, score };
  }
  return null;
}
