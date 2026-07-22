import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeSystemsByDiscipline } from "@/lib/grades";
import { lineStringOrNull } from "@/lib/tracks";
import { SiteNav } from "@/components/site-nav";
import { RouteForm } from "@/app/routes/route-form";
import { updateCustomTrail } from "@/app/routes/actions";
import { ownedCustomTrailWhere } from "@/lib/routes/custom-trails";

export default async function EditCustomTrailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const trail = await prisma.customTrail.findFirst({ where: ownedCustomTrailWhere(user.id, id) });
  if (!trail) notFound();
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 sm:px-6">
    <SiteNav current="/my-trails" /><h1 className="page-title">Edit private trail</h1>
    <p className="mb-6 text-sm text-muted-foreground">Ownership is checked again when this form is submitted.</p>
    <RouteForm action={updateCustomTrail.bind(null, trail.id)} submitLabel="Save changes" cancelHref={`/my-trails/${trail.id}`} initialPath={lineStringOrNull(trail.pathGeojson)} initialPathSource={trail.pathSource} defaultValues={{ name: trail.name, discipline: trail.discipline, gradeSystem: trail.gradeSystem ?? gradeSystemsByDiscipline[trail.discipline][0], gradeRaw: trail.gradeRaw ?? "", area: trail.areaName ?? "", lat: trail.lat, lng: trail.lng, lengthM: trail.lengthM, ascentM: trail.ascentM, estimatedDurationMins: trail.estimatedDurationMins, description: trail.description ?? "" }} />
  </main>;
}
