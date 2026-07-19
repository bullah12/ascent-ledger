import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { AscentStyle } from "@/generated/prisma/enums";
import { createClimb } from "../actions";
import { ClimbForm } from "../climb-form";

export default async function NewClimbPage({
  searchParams,
}: {
  searchParams: Promise<{ routeId?: string }>;
}) {
  await requireOnboardedUser();
  const { routeId } = await searchParams;
  const route = routeId
    ? await prisma.route.findUnique({
        where: { id: routeId },
        select: {
          id: true,
          name: true,
          discipline: true,
          gradeSystem: true,
          gradeRaw: true,
          area: { select: { name: true } },
        },
      })
    : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Log a climb</h1>
      <ClimbForm
        action={createClimb}
        submitLabel="Log climb"
        linkedRoute={route ? {
          id: route.id,
          name: route.name,
          discipline: route.discipline,
          gradeRaw: route.gradeRaw,
          areaName: route.area?.name ?? null,
        } : null}
        defaultValues={route ? {
          routeName: route.name,
          discipline: route.discipline,
          date: new Date().toISOString().slice(0, 10),
          gradeSystem: route.gradeSystem ?? gradeSystemsByDiscipline[route.discipline][0],
          gradeRaw: route.gradeRaw ?? "",
          ascentStyle: AscentStyle.led,
          area: route.area?.name ?? "",
          notes: "",
        } : undefined}
      />
    </main>
  );
}
