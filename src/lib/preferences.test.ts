import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { parseOnboardingForm, persistOnboardingPreferences } from "./preferences";
import { buildStarterPacks } from "./starters";
import { resolveGradeAnchor } from "./recommender";
import type { EngineClimb } from "./bmg/engine";
import starterSeed from "../../docs/starter_routes.seed.json";
import { normaliseGrade } from "./grades";

describe("Phase 10 onboarding and cold start", () => {
  it("validates onboarding and normalises optional provisional grades", () => {
    const form = new FormData();
    form.set("homeRegion", "Scotland");
    form.append("preferredDisciplines", "winter");
    form.append("preferredDisciplines", "hiking");
    form.set("grade_scottish_winter", "V");
    form.set("grade_sac_hiking", "T3");
    const parsed = parseOnboardingForm(form);
    expect(parsed).toEqual({
      success: true,
      data: {
        homeRegion: "Scotland",
        preferredDisciplines: [Discipline.winter, Discipline.hiking],
        provisionalGrades: {
          [GradeSystem.scottish_winter]: 5,
          [GradeSystem.sac_hiking]: 3,
        },
      },
    });
  });

  it("persists one preference row and mirrors home region without creating climbs", async () => {
    const upsert = vi.fn(async (args) => args.create);
    const updateUser = vi.fn(async () => undefined);
    const fake = {
      $transaction: async (callback: (tx: unknown) => unknown) =>
        callback({ userPreference: { upsert }, user: { update: updateUser } }),
    } as unknown as PrismaClient;
    const input = {
      homeRegion: "Wales",
      preferredDisciplines: [Discipline.hiking],
      provisionalGrades: { [GradeSystem.sac_hiking]: 2 },
    };
    await persistOnboardingPreferences(fake, "00000000-0000-0000-0000-000000000001", input);
    expect(upsert).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({
      data: { homeRegion: "Wales" },
    }));
  });

  it("groups starter routes by region and discipline with home matches first", () => {
    const packs = buildStarterPacks([
      {
        id: "1", name: "Alpine route", discipline: Discipline.alpine,
        gradeRaw: "PD", lengthM: null,
        area: { name: "Bernese Alps", region: "Alps", country: "Switzerland" },
      },
      {
        id: "2", name: "Home trail", discipline: Discipline.hiking,
        gradeRaw: null, lengthM: 10000,
        area: { name: "National Trails", region: "England", country: "United Kingdom" },
      },
    ], "England");
    expect(packs[0]).toMatchObject({
      discipline: Discipline.hiking,
      region: "England",
      homeRegionMatch: true,
    });
  });

  it("keeps the starter seed auditable and internally valid", () => {
    expect(starterSeed.routes.length).toBeGreaterThanOrEqual(10);
    for (const route of starterSeed.routes) {
      expect(starterSeed.sources).toHaveProperty(route.source);
      expect(route.external_id).not.toBe("");
      expect(route.name).not.toBe("");
      expect(Number.isFinite(route.lat)).toBe(true);
      expect(Number.isFinite(route.lng)).toBe(true);
      if (route.grade && route.grade_system) {
        const score = normaliseGrade(route.grade_system as GradeSystem, route.grade);
        if (route.grade_system !== GradeSystem.french_sport) expect(score).not.toBeNull();
      }
    }
  });

  it("uses provisional grades only until real history exists", () => {
    expect(resolveGradeAnchor([], Discipline.hiking, GradeSystem.sac_hiking, {
      sac_hiking: 4,
    })).toEqual({ score: 4, provisional: true });
    const climb: EngineClimb = {
      id: "climb-1",
      discipline: Discipline.hiking,
      date: new Date("2026-07-01"),
      ascentStyle: "solo",
      gradeSystem: GradeSystem.sac_hiking,
      gradeRaw: "T2",
      gradeNormalisedScore: 2,
      area: null,
    };
    expect(resolveGradeAnchor([climb], Discipline.hiking, GradeSystem.sac_hiking, {
      sac_hiking: 4,
    })).toEqual({ score: 2, provisional: false });
  });
});
