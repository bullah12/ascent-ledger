import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import {
  DEFAULT_SUGGESTION_WEIGHTS,
  type GradeWindow,
  type SuggestionWeights,
} from "@/lib/suggestions";
import { clamp01 } from "@/lib/scoring";

export type ParsedSuggestionSettings = {
  preferredDisciplines: Discipline[];
  preferredRegions: string[];
  preferredTagSlugs: string[];
  gradeWindows: Partial<Record<GradeSystem, GradeWindow>>;
  maxTripLengthDays: number | null;
  exploreLevel: number;
  weights: SuggestionWeights;
};

export function parseSuggestionSettings(
  formData: FormData,
  allowedTagSlugs: Set<string>
): ParsedSuggestionSettings {
  const preferredDisciplines = formData
    .getAll("preferredDisciplines")
    .filter(
      (value): value is Discipline =>
        typeof value === "string" && Object.values(Discipline).includes(value as Discipline)
    );
  const regionValue = formData.get("preferredRegions");
  const preferredRegions = [
    ...new Set(
      (typeof regionValue === "string" ? regionValue : "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((value) => value.slice(0, 80))
    ),
  ];
  const preferredTagSlugs = formData
    .getAll("preferredTagSlugs")
    .filter((value): value is string => typeof value === "string" && allowedTagSlugs.has(value));

  const gradeWindows: Partial<Record<GradeSystem, GradeWindow>> = {};
  for (const system of Object.values(GradeSystem)) {
    const minValue = formData.get(`gradeMin_${system}`);
    const maxValue = formData.get(`gradeMax_${system}`);
    if (minValue === "" || maxValue === "" || minValue === null || maxValue === null) continue;
    const min = Number(minValue);
    const max = Number(maxValue);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      gradeWindows[system] = { min, max };
    }
  }

  const maxTripValue = Number(formData.get("maxTripLengthDays"));
  const maxTripLengthDays =
    Number.isInteger(maxTripValue) && maxTripValue > 0 && maxTripValue <= 90
      ? maxTripValue
      : null;
  const rawExplore = Number(formData.get("exploreLevel"));
  const exploreLevel = Number.isFinite(rawExplore) ? clamp01(rawExplore) : 0.35;
  const weights = { ...DEFAULT_SUGGESTION_WEIGHTS };
  for (const key of Object.keys(weights) as (keyof SuggestionWeights)[]) {
    const value = Number(formData.get(`suggestion_${key}`));
    if (Number.isFinite(value) && value >= 0 && value <= 100) weights[key] = value;
  }

  return {
    preferredDisciplines,
    preferredRegions,
    preferredTagSlugs,
    gradeWindows,
    maxTripLengthDays,
    exploreLevel,
    weights,
  };
}
