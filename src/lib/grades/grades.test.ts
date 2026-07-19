import { describe, expect, it } from "vitest";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { csvRowSchema } from "@/lib/climbs/csv";
import { climbInputSchema } from "@/lib/climbs/validation";
import { routeInputSchema } from "@/lib/routes/validation";
import { gradeSystemsByDiscipline, inferGrade, normaliseGrade } from ".";

describe("SAC hiking grades", () => {
  it("normalises the complete T1–T6 ladder and rejects values outside it", () => {
    for (let grade = 1; grade <= 6; grade++) {
      expect(normaliseGrade(GradeSystem.sac_hiking, `T${grade}`)).toBe(grade);
      expect(normaliseGrade(GradeSystem.sac_hiking, `t${grade} alpine hike`)).toBe(grade);
    }
    expect(normaliseGrade(GradeSystem.sac_hiking, "T0")).toBeNull();
    expect(normaliseGrade(GradeSystem.sac_hiking, "T7")).toBeNull();
  });

  it("flows through form and CSV validation with no hiking BMG category", () => {
    expect(gradeSystemsByDiscipline[Discipline.hiking]).toEqual([GradeSystem.sac_hiking]);
    expect(inferGrade(Discipline.hiking, "T4")).toEqual({
      system: GradeSystem.sac_hiking,
      score: 4,
    });
    expect(climbInputSchema.safeParse({
      routeName: "Fixture hike",
      discipline: "hiking",
      date: "2026-07-19",
      gradeSystem: "sac_hiking",
      gradeRaw: "T2",
      ascentStyle: "solo",
    }).success).toBe(true);
    expect(routeInputSchema.safeParse({
      name: "Fixture hike",
      discipline: "hiking",
      gradeSystem: "sac_hiking",
      gradeRaw: "T2",
    }).success).toBe(true);
    expect(csvRowSchema.safeParse({
      date: "2026-07-19",
      route_name: "Fixture hike",
      discipline: "hiking",
      grade: "T2",
      ascent_style: "solo",
      grade_system: "sac_hiking",
    }).success).toBe(true);
    expect(routeInputSchema.safeParse({
      name: "Bad pairing",
      discipline: "hiking",
      gradeSystem: "uk_trad",
    }).success).toBe(false);
  });
});
