import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { SiteNav } from "@/components/site-nav";
import { MapView, type ClimbFeature } from "./map-view";

export default async function MapPage() {
  const user = await requireUser();

  const [located, totalClimbs] = await Promise.all([
    prisma.climb.findMany({
      where: {
        userId: user.id,
        route: { lat: { not: null }, lng: { not: null } },
      },
      select: {
        freeTextRouteName: true,
        gradeRaw: true,
        date: true,
        discipline: true,
        route: {
          select: { name: true, lat: true, lng: true, area: { select: { name: true } } },
        },
      },
      orderBy: { date: "desc" },
    }),
    prisma.climb.count({ where: { userId: user.id } }),
  ]);

  const features: ClimbFeature[] = located.map((climb) => ({
    // The where clause guarantees route+coords exist; assert for TS.
    lat: climb.route!.lat!,
    lng: climb.route!.lng!,
    name: climb.route!.name || climb.freeTextRouteName,
    gradeRaw: climb.gradeRaw,
    date: climb.date.toISOString().slice(0, 10),
    discipline: disciplineLabels[climb.discipline],
    areaName: climb.route!.area?.name ?? null,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <SiteNav current="/map" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Map</h1>
        <p className="text-sm text-muted-foreground">
          {features.length === 0
            ? "No mappable climbs yet — link your climbs to routes that have coordinates."
            : `${features.length} of ${totalClimbs} logged climbs are linked to a located route.`}
        </p>
      </div>

      <MapView climbs={features} />

      {features.length < totalClimbs && (
        <p className="mt-3 text-xs text-muted-foreground">
          Climbs only appear here when linked to a{" "}
          <Link href="/routes" className="underline">
            route
          </Link>{" "}
          with latitude/longitude. Edit a climb in the{" "}
          <Link href="/logbook" className="underline">
            logbook
          </Link>{" "}
          to link it.
        </p>
      )}
    </main>
  );
}
