import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { lineStringOrNull } from "@/lib/tracks";
import { updateRoute } from "../../actions";
import { RouteForm } from "../../route-form";
import { SiteNav } from "@/components/site-nav";

export default async function EditRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireOnboardedUser();

  const route = await prisma.route.findUnique({
    where: { id },
    include: { area: { select: { name: true } } },
  });
  if (!route) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 sm:px-6">
      <SiteNav current="/routes" />
      <h1 className="page-title">Edit route</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        A stored line uses its first point as the route&apos;s representative map location.
      </p>
      <RouteForm
        action={updateRoute.bind(null, route.id)}
        submitLabel="Save changes"
        initialPath={lineStringOrNull(route.pathGeojson)}
        initialPathSource={route.pathSource}
        defaultValues={{
          name: route.name,
          discipline: route.discipline,
          gradeSystem:
            route.gradeSystem ?? gradeSystemsByDiscipline[route.discipline][0],
          gradeRaw: route.gradeRaw ?? "",
          area: route.area?.name ?? "",
          lat: route.lat,
          lng: route.lng,
          lengthM: route.lengthM,
          ascentM: route.ascentM,
          estimatedDurationMins: route.estimatedDurationMins,
          description: route.description ?? "",
        }}
      />
    </main>
  );
}
