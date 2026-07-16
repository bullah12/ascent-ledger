import type { Discipline, GradeSystem, AscentStyle } from "@/generated/prisma/enums";
import { inferGrade, gradeLabelForScore } from "@/lib/grades";

// BMG rules engine — pure function per PLAN.md §4. Takes categories+rules
// (from the BmgRule config table) and the user's climbs, returns per-rule
// and per-category progress. Never throws on bad grade data: a climb whose
// grade doesn't parse is "ungraded" — it still counts toward rules without
// a grade threshold, and is reported per category.

export type EngineClimb = {
  id: string;
  discipline: Discipline;
  date: Date;
  ascentStyle: AscentStyle;
  gradeSystem: GradeSystem | null;
  gradeRaw: string;
  gradeNormalisedScore: number | null;
  area: { id: string; name: string; region: string | null; country: string | null } | null;
};

export type EngineRule = {
  id: string;
  description: string;
  gradeSystem: GradeSystem | null;
  minGradeRaw: string | null;
  minGradeNormalisedScore: number | null;
  minCount: number;
  extraConstraintJson: unknown;
  verified: boolean;
};

export type EngineCategory = {
  id: string;
  key: Discipline;
  label: string;
  description: string | null;
  rules: EngineRule[];
};

export type RuleProgress = {
  id: string;
  description: string;
  minCount: number;
  actualCount: number;
  stillNeeded: number;
  met: boolean;
  /** 0–100, count progress capped at 100. */
  percent: number;
  /** Human threshold like "TD (alpine overall)", null for count-only rules. */
  thresholdLabel: string | null;
  verified: boolean;
  /** Set-level shortfalls and unenforceable-constraint caveats. */
  notes: string[];
};

export type CategoryProgress = {
  id: string;
  key: Discipline;
  label: string;
  description: string | null;
  /** Weighted average of rule completion, weighted by min_count. */
  percent: number;
  metRules: number;
  totalRules: number;
  rules: RuleProgress[];
  /** Climbs in this discipline whose grade didn't parse. */
  ungradedCount: number;
};

type Constraint = {
  regions?: string[];
  region?: string;
  style?: string[];
  min_years_span?: number;
  min_distinct_areas?: number;
  unit?: string;
  terrain?: string;
  access?: string;
  min_consecutive_nights?: number;
};

function asConstraint(json: unknown): Constraint {
  return json && typeof json === "object" ? (json as Constraint) : {};
}

// Region names as they might appear in Area.region / Area.country / name.
const REGION_TOKENS: Record<string, string[]> = {
  uk: ["uk", "united kingdom", "great britain", "britain", "scotland", "england", "wales", "northern ireland"],
  "alps or equivalent": ["alps", "alpes", "alpen", "alpi"],
  alps: ["alps", "alpes", "alpen", "alpi"],
  scotland: ["scotland"],
  england: ["england"],
  wales: ["wales"],
};

function tokensFor(regionName: string): string[] {
  return REGION_TOKENS[regionName.toLowerCase()] ?? [regionName.toLowerCase()];
}

// Lenient region check: only exclude when the area actually carries
// region/country data and none of it matches. Name-only areas (Phase 1
// free text) pass — the dashboard is a motivator, not an audit. Also used
// by the recommender to apply rule constraints to candidate routes.
export function areaMatchesRegions(
  area: { name: string; region: string | null; country: string | null } | null,
  allowed: string[]
): boolean {
  if (!area || (!area.region && !area.country)) return true;
  const haystack = [area.region, area.country, area.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return allowed.some((name) =>
    tokensFor(name).some((token) => haystack.includes(token))
  );
}

function matchesRegions(climb: EngineClimb, allowed: string[]): boolean {
  return areaMatchesRegions(climb.area, allowed);
}

/**
 * Effective grade of a climb: the stored system+score when present,
 * otherwise a best-effort parse (covers Phase 1 rows logged before the
 * grade engine existed). Null = ungraded.
 */
export function effectiveGrade(
  climb: EngineClimb
): { system: GradeSystem; score: number } | null {
  if (climb.gradeSystem && climb.gradeNormalisedScore !== null) {
    return { system: climb.gradeSystem, score: climb.gradeNormalisedScore };
  }
  return inferGrade(climb.discipline, climb.gradeRaw);
}

function evaluateRule(rule: EngineRule, climbs: EngineClimb[]): RuleProgress {
  const constraint = asConstraint(rule.extraConstraintJson);
  const notes: string[] = [];

  let qualifying = climbs;

  if (rule.minGradeNormalisedScore !== null) {
    const threshold = rule.minGradeNormalisedScore;
    qualifying = qualifying.filter((climb) => {
      const grade = effectiveGrade(climb);
      if (!grade) return false;
      // A threshold is only meaningful within its own grade system.
      if (rule.gradeSystem && grade.system !== rule.gradeSystem) return false;
      return grade.score >= threshold;
    });
  }

  if (constraint.style) {
    const styles = constraint.style;
    qualifying = qualifying.filter((c) => styles.includes(c.ascentStyle));
  }

  const regionList = constraint.regions ?? (constraint.region ? [constraint.region] : null);
  if (regionList) {
    qualifying = qualifying.filter((c) => matchesRegions(c, regionList));
  }

  const actualCount = qualifying.length;
  let met = actualCount >= rule.minCount;

  // Set-level constraints: evaluated across the qualifying set, not per climb.
  if (constraint.min_years_span) {
    const years = qualifying.map((c) => c.date.getUTCFullYear());
    const span = years.length ? Math.max(...years) - Math.min(...years) + 1 : 0;
    if (span < constraint.min_years_span) {
      met = false;
      notes.push(`spanning ${span} of ${constraint.min_years_span} required years`);
    }
  }
  if (constraint.min_distinct_areas) {
    const areas = new Set(
      qualifying.map((c) => c.area?.id ?? c.area?.name).filter(Boolean)
    );
    if (areas.size < constraint.min_distinct_areas) {
      met = false;
      notes.push(`${areas.size} of ${constraint.min_distinct_areas} required distinct areas`);
    }
  }

  // Constraints the current data model can't check — surfaced, not enforced.
  if (constraint.unit === "days") {
    notes.push("each logged entry counts as one day");
  }
  if (constraint.min_consecutive_nights) {
    notes.push(`"${constraint.min_consecutive_nights}+ consecutive nights" not yet checkable — counting all qualifying entries`);
  }
  if (constraint.access) {
    notes.push(`"${constraint.access}-accessed" not yet checkable`);
  }
  if (constraint.terrain) {
    notes.push(`"${constraint.terrain} terrain" not yet checkable`);
  }

  const thresholdLabel =
    rule.gradeSystem && rule.minGradeNormalisedScore !== null
      ? gradeLabelForScore(rule.gradeSystem, rule.minGradeNormalisedScore) ??
        rule.minGradeRaw
      : null;

  return {
    id: rule.id,
    description: rule.description,
    minCount: rule.minCount,
    actualCount,
    stillNeeded: Math.max(0, rule.minCount - actualCount),
    met,
    percent: Math.min(100, Math.round((actualCount / rule.minCount) * 100)),
    thresholdLabel,
    verified: rule.verified,
    notes,
  };
}

export function evaluateProgress(
  categories: EngineCategory[],
  climbs: EngineClimb[]
): CategoryProgress[] {
  return categories.map((category) => {
    const categoryClimbs = climbs.filter((c) => c.discipline === category.key);
    const rules = category.rules.map((rule) => evaluateRule(rule, categoryClimbs));

    // Weighted average of rule completion, weighted by min_count (PLAN §4).
    const totalRequired = rules.reduce((sum, r) => sum + r.minCount, 0);
    const totalDone = rules.reduce(
      (sum, r) => sum + Math.min(r.actualCount, r.minCount),
      0
    );

    return {
      id: category.id,
      key: category.key,
      label: category.label,
      description: category.description,
      percent: totalRequired ? Math.round((totalDone / totalRequired) * 100) : 0,
      metRules: rules.filter((r) => r.met).length,
      totalRules: rules.length,
      rules,
      ungradedCount: categoryClimbs.filter((c) => effectiveGrade(c) === null).length,
    };
  });
}
