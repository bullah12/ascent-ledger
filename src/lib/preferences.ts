import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { gradeSystemsByDiscipline, normaliseGrade } from "@/lib/grades";

export type OnboardingInput = {
  homeRegion: string;
  preferredDisciplines: Discipline[];
  provisionalGrades: Partial<Record<GradeSystem, number>>;
};

const baseSchema = z.object({
  homeRegion: z.string().trim().min(2, "Enter a home region").max(120),
  preferredDisciplines: z.array(z.enum(Discipline)).min(1, "Pick at least one discipline"),
});

export function parseOnboardingForm(formData: FormData):
  | { success: true; data: OnboardingInput }
  | { success: false; error: string } {
  const parsed = baseSchema.safeParse({
    homeRegion: formData.get("homeRegion"),
    preferredDisciplines: formData.getAll("preferredDisciplines"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const allowedSystems = new Set(
    parsed.data.preferredDisciplines.flatMap((discipline) =>
      gradeSystemsByDiscipline[discipline]
    )
  );
  const provisionalGrades: Partial<Record<GradeSystem, number>> = {};
  for (const system of allowedSystems) {
    const raw = formData.get(`grade_${system}`);
    if (typeof raw !== "string" || !raw.trim()) continue;
    const score = normaliseGrade(system, raw);
    if (score === null) return { success: false, error: `${raw} is not recognised for ${system}` };
    provisionalGrades[system] = score;
  }
  return { success: true, data: { ...parsed.data, provisionalGrades } };
}

export async function persistOnboardingPreferences(
  prisma: PrismaClient,
  userId: string,
  input: OnboardingInput
) {
  return prisma.$transaction(async (tx) => {
    const preference = await tx.userPreference.upsert({
      where: { userId },
      update: {
        preferredDisciplines: input.preferredDisciplines,
        homeRegion: input.homeRegion,
        provisionalGradesJson: input.provisionalGrades,
      },
      create: {
        userId,
        preferredDisciplines: input.preferredDisciplines,
        homeRegion: input.homeRegion,
        provisionalGradesJson: input.provisionalGrades,
      },
    });
    await tx.user.update({ where: { id: userId }, data: { homeRegion: input.homeRegion } });
    return preference;
  });
}
