import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { updateClimb } from "../../actions";
import { ClimbForm } from "../../climb-form";
import { lineStringOrNull } from "@/lib/tracks";
import { SiteNav } from "@/components/site-nav";

export default async function EditClimbPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireOnboardedUser();

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
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-8 sm:px-6 lg:px-8">
      <SiteNav current="/logbook" />
      <div className="mb-7">
        <p className="instrument-label mb-2 text-primary">Logbook · edit entry</p>
        <h1 className="page-title">Edit climb</h1>
        <p className="mt-2 text-base text-muted-foreground">Update the details that feed your progression and recommendations.</p>
      </div>
      <ClimbForm
        action={boundUpdate}
        submitLabel="Save changes"
        existingPhotos={climb.photoUrls}
        existingTrackUrl={climb.gpxTrackUrl}
        initialPath={lineStringOrNull(climb.pathGeojson)}
        initialPathSource={climb.pathSource}
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
          visibility: climb.visibility,
          ascentM: climb.ascentM,
          durationMinutes: climb.durationMinutes,
          variant: climb.variant,
          conditions: climb.conditions,
          partners: climb.partners.join(", "),
          rating: climb.rating,
        }}
      />
    </main>
  );
}
