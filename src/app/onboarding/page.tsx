import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeLadder, gradeSystemLabels, gradeSystemsByDiscipline } from "@/lib/grades";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await prisma.userPreference.findUnique({ where: { userId: user.id } });
  if (existing) redirect("/dashboard");

  const gradeOptions = Object.fromEntries(
    Object.values(gradeSystemsByDiscipline)
      .flat()
      .map((system) => [
        system,
        {
          label: gradeSystemLabels[system],
          entries: gradeLadder(system).entries.map((entry) => entry.label),
        },
      ])
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center p-4 sm:p-6">
      <OnboardingForm gradeOptions={gradeOptions} />
    </main>
  );
}
