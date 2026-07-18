import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import { SiteNav } from "@/components/site-nav";
import {
  MapView,
  type ClimbFeature,
  type GpxTrack,
  type SuggestedFeature,
} from "./map-view";

export default async function MapPage() {
  const user = await requireUser();

  const [located, totalClimbs, { categorySuggestions }, gpxClimbs] = await Promise.all([
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
    getUserProgressAndSuggestions(prisma, user),
    prisma.climb.findMany({
      where: { userId: user.id, gpxTrackUrl: { not: null } },
      select: { freeTextRouteName: true, gpxTrackUrl: true },
      orderBy: { date: "desc" },
      take: 20,
    }),
  ]);

  const tracks: GpxTrack[] = gpxClimbs.map((climb) => ({
    url: climb.gpxTrackUrl!,
    name: climb.freeTextRouteName,
  }));

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

  // Suggested routes across all unmet rules, deduped (a route can close
  // more than one gap), keeping the discipline for the per-category toggle.
  const suggestedById = new Map<string, SuggestedFeature>();
  for (const category of categorySuggestions) {
    for (const rule of category.rules) {
      for (const s of rule.suggestions) {
        if (s.lat === null || s.lng === null || suggestedById.has(s.routeId)) continue;
        suggestedById.set(s.routeId, {
          lat: s.lat,
          lng: s.lng,
          name: s.name,
          gradeRaw: s.gradeRaw,
          areaName: s.areaName,
          category: category.categoryKey,
          categoryLabel: disciplineLabels[category.categoryKey],
          why: s.why,
        });
      }
    }
  }
  const suggested = [...suggestedById.values()];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
      <SiteNav current="/map" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Map</h1>
        <p className="text-sm text-muted-foreground">
          {features.length === 0
            ? "No mappable climbs yet — link your climbs to routes that have coordinates."
            : `${features.length} of ${totalClimbs} logged climbs are linked to a located route.`}
        </p>
      </div>

      <MapView climbs={features} suggested={suggested} tracks={tracks} />

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
