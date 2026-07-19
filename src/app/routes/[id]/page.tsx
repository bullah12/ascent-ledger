import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { gradeSystemLabels } from "@/lib/grades";
import { sourceAttribution } from "@/lib/importers/source-attribution";
import { SiteNav } from "@/components/site-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser();
  const route = await prisma.route.findUnique({
    where: { id },
    include: { area: { select: { name: true, region: true, country: true } } },
  });
  if (!route) notFound();
  const attribution = sourceAttribution(route.externalSource);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <SiteNav current="/routes" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge>{disciplineLabels[route.discipline]}</Badge>
            {route.pathGeojson && <Badge variant="outline">route geometry</Badge>}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{route.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[route.area?.name, route.area?.region, route.area?.country]
              .filter(Boolean)
              .join(" · ") || "Area not recorded"}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/routes/${route.id}/edit`} />}>
          Edit
        </Button>
      </div>

      <dl className="grid gap-4 rounded-lg border p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Grade</dt>
          <dd className="font-medium">
            {route.gradeRaw ?? "Not graded"}
            {route.gradeSystem ? ` · ${gradeSystemLabels[route.gradeSystem]}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Distance</dt>
          <dd className="font-medium">
            {route.lengthM ? `${(route.lengthM / 1_000).toFixed(1)} km` : "Not recorded"}
          </dd>
        </div>
        {route.description && (
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">Description</dt>
            <dd className="whitespace-pre-wrap">{route.description}</dd>
          </div>
        )}
      </dl>

      {attribution && (
        <aside className="mt-6 rounded-lg bg-muted/50 p-4 text-sm">
          <p className="font-medium">Source and licence</p>
          <p className="mt-1 text-muted-foreground">{attribution.attribution}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <a className="underline" href={route.externalUrl ?? attribution.sourceUrl}>
              View source record
            </a>
            <a className="underline" href={attribution.licenceUrl}>
              {attribution.licence}
            </a>
          </div>
        </aside>
      )}
    </main>
  );
}
