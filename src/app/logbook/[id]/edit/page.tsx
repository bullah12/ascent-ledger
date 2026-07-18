import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { updateClimb } from "../../actions";
import { ClimbForm } from "../../climb-form";

export default async function EditClimbPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const climb = await prisma.climb.findFirst({
    where: { id, userId: user.id },
    include: {
      area: { select: { name: true } },
      route: {
        select: {
          id: true,
          name: true,
          discipline: true,
          gradeRaw: true,
          area: { select: { name: true } },
        },
      },
    },
  });

  if (!climb) {
    notFound();
  }

  const boundUpdate = updateClimb.bind(null, climb.id);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Edit climb</h1>
      <ClimbForm
        action={boundUpdate}
        submitLabel="Save changes"
        existingPhotos={climb.photoUrls}
        existingGpxUrl={climb.gpxTrackUrl}
        linkedRoute={
          climb.route
            ? {
                id: climb.route.id,
                name: climb.route.name,
                discipline: climb.route.discipline,
                gradeRaw: climb.route.gradeRaw,
                areaName: climb.route.area?.name ?? null,
              }
            : null
        }
        defaultValues={{
          routeName: climb.freeTextRouteName,
          discipline: climb.discipline,
          date: climb.date.toISOString().slice(0, 10),
          // Phase 1 rows predate the grade engine and have no system stored;
          // preselect the discipline's default so saving backfills it.
          gradeSystem:
            climb.gradeSystem ?? gradeSystemsByDiscipline[climb.discipline][0],
          gradeRaw: climb.gradeRaw,
          ascentStyle: climb.ascentStyle,
          area: climb.area?.name ?? "",
          notes: climb.notes ?? "",
        }}
      />
    </main>
  );
}
