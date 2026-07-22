import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lineStringOrNull } from "@/lib/tracks";
import { disciplineLabels } from "@/lib/climbs/labels";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RouteDetailMap } from "@/app/routes/[id]/route-detail-map";
import { deleteCustomTrail } from "@/app/routes/actions";
import { ownedCustomTrailWhere } from "@/lib/routes/custom-trails";

export default async function CustomTrailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  const trail = await prisma.customTrail.findFirst({ where: ownedCustomTrailWhere(user.id, id), include: { _count: { select: { climbs: true } } } });
  if (!trail) notFound();
  const geometry = lineStringOrNull(trail.pathGeojson);
  const point = trail.lat !== null && trail.lng !== null ? { lat: trail.lat, lng: trail.lng } : null;
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-10 sm:px-6">
    <SiteNav current="/my-trails" />
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="instrument-label mb-2 text-primary">Private custom trail</p><h1 className="page-title">{trail.name}</h1><div className="mt-3 flex gap-2"><Badge>{disciplineLabels[trail.discipline]}</Badge>{trail.gradeRaw && <Badge variant="secondary">{trail.gradeRaw}</Badge>}</div></div><div className="flex gap-2"><Button variant="outline" render={<Link href={`/my-trails/${trail.id}/edit`} />}>Edit</Button><Button render={<Link href={`/logbook/new?customTrailId=${trail.id}`} />}>Log this trail</Button></div></div>
    <div className="grid gap-6 lg:grid-cols-2"><div><RouteDetailMap geometry={geometry} point={point} /></div><div className="space-y-4"><p>{trail.description ?? "No description recorded."}</p><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Area</dt><dd>{trail.areaName ?? "—"}</dd></div><div><dt className="text-muted-foreground">Linked logs</dt><dd>{trail._count.climbs}</dd></div><div><dt className="text-muted-foreground">Distance</dt><dd>{trail.lengthM ? `${(trail.lengthM / 1000).toFixed(1)} km` : "—"}</dd></div><div><dt className="text-muted-foreground">Ascent</dt><dd>{trail.ascentM ? `${trail.ascentM} m` : "—"}</dd></div></dl><form action={deleteCustomTrail}><input type="hidden" name="trailId" value={trail.id} /><Button type="submit" variant="ghost" className="text-destructive">Delete trail</Button></form></div></div>
  </main>;
}
