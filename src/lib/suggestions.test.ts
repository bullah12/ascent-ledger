import { describe, expect, it } from "vitest";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import {
  DEFAULT_SUGGESTION_WEIGHTS,
  buildAffinityProfile,
  scoreCandidateRoutes,
  type SuggestionCandidate,
  type SuggestionHistory,
  type SuggestionPreferences,
} from "./suggestions";
import { parseSuggestionSettings } from "./suggestion-settings";

const now = new Date("2026-07-19T00:00:00.000Z");

function history(overrides: Partial<SuggestionHistory> = {}): SuggestionHistory {
  return {
    routeId: "completed",
    routeName: "Completed route",
    discipline: Discipline.hiking,
    date: new Date("2026-07-01"),
    gradeSystem: GradeSystem.sac_hiking,
    gradeScore: 3,
    area: "Glencoe",
    region: "Scotland",
    tagSlugs: ["scenic"],
    lat: 56.68,
    lng: -5.1,
    ...overrides,
  };
}

function candidate(overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    id: "candidate",
    name: "Candidate route",
    discipline: Discipline.hiking,
    gradeSystem: GradeSystem.sac_hiking,
    gradeRaw: "T3",
    gradeScore: 3,
    areaName: "Glencoe",
    region: "Scotland",
    country: "United Kingdom",
    tagSlugs: ["scenic"],
    lengthM: 10_000,
    pitches: null,
    lat: 56.7,
    lng: -5.05,
    avgRating: 4.5,
    qualityRating: 3,
    ...overrides,
  };
}

function preferences(overrides: Partial<SuggestionPreferences> = {}): SuggestionPreferences {
  return {
    preferredDisciplines: [Discipline.hiking],
    preferredRegions: ["Scotland"],
    preferredTagSlugs: ["scenic"],
    gradeWindows: { [GradeSystem.sac_hiking]: { min: 1, max: 4 } },
    maxTripLengthDays: 1,
    exploreLevel: 0.35,
    weights: DEFAULT_SUGGESTION_WEIGHTS,
    ...overrides,
  };
}

describe("general preference suggestion engine", () => {
  it("uses recency decay and a recent distribution band rather than all-time max", () => {
    const profile = buildAffinityProfile([
      history({ area: "Old area", date: new Date("2020-01-01"), gradeScore: 10 }),
      history({ routeId: "2", routeName: "Two", area: "Recent area", gradeScore: 2 }),
      history({ routeId: "3", routeName: "Three", area: "Recent area", gradeScore: 3 }),
      history({ routeId: "4", routeName: "Four", area: "Recent area", gradeScore: 4 }),
    ], now);
    expect(profile.areas.get("recent area")).toBe(1);
    expect(profile.areas.get("old area")).toBeLessThan(0.01);
    expect(profile.gradeBands.get(GradeSystem.sac_hiking)).toMatchObject({
      low: 2,
      high: 4,
      provisional: false,
    });
  });

  it("applies discipline, region, grade-window, and trip-length gates", () => {
    const output = scoreCandidateRoutes([
      candidate({ id: "good", name: "Good" }),
      candidate({ id: "discipline", name: "Wrong discipline", discipline: Discipline.rock }),
      candidate({ id: "region", name: "Wrong region", region: "Alps", areaName: "Bernese Alps", country: "Switzerland" }),
      candidate({ id: "grade", name: "Outside grade", gradeScore: 5, gradeRaw: "T5" }),
      candidate({ id: "long", name: "Too long", lengthM: 50_000 }),
    ], [], preferences(), now);
    expect(output.map((item) => item.routeId)).toEqual(["good"]);
  });

  it("boosts preferred tags and uses community rating before source quality", () => {
    const tagAndQualityWeights = {
      ...DEFAULT_SUGGESTION_WEIGHTS,
      gradeComfort: 0,
      disciplineAffinity: 0,
      familiarity: 0,
      explicitPreferences: 0,
      preferredTags: 5,
      quality: 4,
      tripFit: 0,
      distancePenalty: 0,
    };
    const output = scoreCandidateRoutes([
      candidate({ id: "preferred", name: "Preferred", avgRating: 5, qualityRating: 1 }),
      candidate({ id: "source-fallback", name: "Source fallback", tagSlugs: [], avgRating: null, qualityRating: 5 }),
      candidate({ id: "community-wins", name: "Community wins", tagSlugs: [], avgRating: 1, qualityRating: 5 }),
    ], [], preferences({ weights: tagAndQualityWeights }), now);
    expect(output.map((item) => item.routeId)).toEqual([
      "preferred",
      "source-fallback",
      "community-wins",
    ]);
    expect(output[0].why).toBe("matches 1 preferred tag; well rated by the community (5.0/5)");
  });

  it("moves from familiar routes toward novelty as explore level increases", () => {
    const affinityOnly = {
      ...DEFAULT_SUGGESTION_WEIGHTS,
      gradeComfort: 0,
      disciplineAffinity: 0,
      familiarity: 1,
      explicitPreferences: 0,
      preferredTags: 0,
      quality: 0,
      tripFit: 0,
      distancePenalty: 0,
    };
    const routes = [
      candidate({ id: "familiar", name: "Familiar" }),
      candidate({ id: "novel", name: "Novel", areaName: "Cairngorms", region: "Scotland", tagSlugs: [] }),
    ];
    const familiarFirst = scoreCandidateRoutes(
      routes,
      [history()],
      preferences({ exploreLevel: 0.2, weights: affinityOnly }),
      now
    );
    const novelFirst = scoreCandidateRoutes(
      routes,
      [history()],
      preferences({ exploreLevel: 0.8, weights: affinityOnly }),
      now
    );
    expect(familiarFirst[0].routeId).toBe("familiar");
    expect(novelFirst[0].routeId).toBe("novel");
  });

  it("excludes completed IDs and name matches and orders ties deterministically", () => {
    const output = scoreCandidateRoutes([
      candidate({ id: "completed", name: "Different name" }),
      candidate({ id: "same-name", name: "Completed route" }),
      candidate({ id: "z", name: "Zulu" }),
      candidate({ id: "b", name: "Alpha" }),
      candidate({ id: "a", name: "Alpha" }),
    ], [history()], preferences(), now);
    expect(output.map((item) => item.routeId)).toEqual(["a", "b", "z"]);
  });

  it("handles no history, sparse data, missing tags, and missing ratings", () => {
    const output = scoreCandidateRoutes([
      candidate({
        id: "sparse",
        tagSlugs: [],
        gradeSystem: null,
        gradeRaw: null,
        gradeScore: null,
        avgRating: null,
        qualityRating: null,
        lat: null,
        lng: null,
      }),
    ], [], preferences({
      preferredTagSlugs: [],
      gradeWindows: {},
      maxTripLengthDays: null,
    }), now);
    expect(output).toHaveLength(1);
    expect(output[0].score).toBeGreaterThanOrEqual(0);
    expect(output[0].score).toBeLessThanOrEqual(1);
    expect(output[0].why).not.toBe("");
    for (const value of Object.values(output[0].terms)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("uses provisional grade comfort only when no real band exists", () => {
    const provisional = buildAffinityProfile([], now, { sac_hiking: 4 });
    expect(provisional.gradeBands.get(GradeSystem.sac_hiking)).toEqual({
      low: 4,
      high: 4,
      provisional: true,
    });
    const real = buildAffinityProfile([history({ gradeScore: 2 })], now, { sac_hiking: 4 });
    expect(real.gradeBands.get(GradeSystem.sac_hiking)).toEqual({
      low: 2,
      high: 2,
      provisional: false,
    });
  });

  it("parses and constrains persisted suggestion settings independently of BMG weights", () => {
    const form = new FormData();
    form.append("preferredDisciplines", "hiking");
    form.set("preferredRegions", "Scotland, Alps\nScotland");
    form.append("preferredTagSlugs", "scenic");
    form.append("preferredTagSlugs", "not-curated");
    form.set("gradeMin_sac_hiking", "2");
    form.set("gradeMax_sac_hiking", "4");
    form.set("maxTripLengthDays", "3");
    form.set("exploreLevel", "0.35");
    form.set("suggestion_quality", "7");
    const parsed = parseSuggestionSettings(form, new Set(["scenic"]));
    expect(parsed).toMatchObject({
      preferredDisciplines: [Discipline.hiking],
      preferredRegions: ["Scotland", "Alps"],
      preferredTagSlugs: ["scenic"],
      gradeWindows: { sac_hiking: { min: 2, max: 4 } },
      maxTripLengthDays: 3,
      exploreLevel: 0.35,
      weights: { quality: 7 },
    });
  });
});
