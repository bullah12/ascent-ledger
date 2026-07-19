import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { DEFAULT_WEIGHTS, getSuggestions } from "./recommender";

const area = {
  id: "area-new",
  name: "New Crag",
  region: "Scotland",
  country: "United Kingdom",
};

function route(id: string, name: string, score: number, qualityRating: number) {
  return {
    id,
    name,
    discipline: Discipline.winter,
    gradeSystem: GradeSystem.scottish_winter,
    gradeRaw: ["I", "II", "III", "IV", "V", "VI", "VII"][score - 1],
    gradeNormalisedScore: score,
    lat: null,
    lng: null,
    qualityRating,
    externalUrl: `https://example.test/${id}`,
    area,
  };
}

function fakePrisma(routes: ReturnType<typeof route>[], climbs: unknown[]) {
  return {
    route: { findMany: async () => routes },
    climb: { findMany: async () => climbs },
  } as unknown as PrismaClient;
}

const categories = [{
  key: Discipline.winter,
  rules: [{
    id: "rule-1",
    gradeSystem: GradeSystem.scottish_winter,
    minGradeNormalisedScore: 5,
    extraConstraintJson: { regions: ["Scotland"] },
    met: false,
  }],
}];

describe("BMG recommender characterization before shared scoring extraction", () => {
  it("locks current real-history ranking, scores, and explanations", async () => {
    const prisma = fakePrisma([
      route("next", "Next grade", 6, 3),
      route("same", "Same grade, great source rating", 5, 5),
      route("stretch", "Two-grade stretch", 7, 1),
      route("too-hard", "Outside window", 8, 5),
    ], [{
      id: "climb-1",
      discipline: Discipline.winter,
      date: new Date("2026-07-01"),
      ascentStyle: "led",
      freeTextRouteName: "Existing climb",
      gradeSystem: GradeSystem.scottish_winter,
      gradeRaw: "V,5",
      gradeNormalisedScore: 5,
      routeId: null,
      route: null,
      area: null,
    }]);
    const output = await getSuggestions(prisma, "user-1", categories, DEFAULT_WEIGHTS);
    expect(output[0].rules[0].suggestions.map((item) => ({
      id: item.routeId,
      score: item.score,
      why: item.why,
    }))).toEqual([
      { id: "next", score: 4, why: "one grade step up from your current V max; new area for you (New Crag)" },
      { id: "same", score: 3.5, why: "at your current V level; well regarded (5/5)" },
      { id: "stretch", score: 2.5, why: "2 grade steps above your current V max; new area for you (New Crag)" },
    ]);
  });

  it("locks no-history threshold anchoring and completed-route exclusion", async () => {
    const prisma = fakePrisma([
      route("threshold", "Threshold route", 5, 3),
      route("above", "Above threshold", 6, 3),
      route("done", "Already done", 5, 5),
    ], [{
      id: "climb-1",
      discipline: Discipline.rock,
      date: new Date("2026-07-01"),
      ascentStyle: "led",
      freeTextRouteName: "Already done",
      gradeSystem: GradeSystem.uk_trad,
      gradeRaw: "VD",
      gradeNormalisedScore: 4,
      routeId: "done",
      route: null,
      area: null,
    }]);
    const output = await getSuggestions(prisma, "user-1", categories, DEFAULT_WEIGHTS);
    expect(output[0].rules[0].suggestions.map((item) => [item.routeId, item.score, item.why])).toEqual([
      ["threshold", 4, "at the rule's target grade (V); new area for you (New Crag)"],
      ["above", 3, "at the rule's target grade (VI); new area for you (New Crag)"],
    ]);
  });

  it("locks provisional cold-start behavior without treating it as real history", async () => {
    const prisma = fakePrisma([route("provisional-next", "Provisional next", 5, 3)], []);
    const output = await getSuggestions(
      prisma,
      "user-1",
      categories,
      DEFAULT_WEIGHTS,
      { scottish_winter: 4 }
    );
    expect(output[0].rules[0].suggestions[0]).toMatchObject({
      routeId: "provisional-next",
      score: 4,
      why: "based on your provisional IV level; new area for you (New Crag)",
    });
  });
});
