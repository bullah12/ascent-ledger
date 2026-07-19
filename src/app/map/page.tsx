import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { disciplineLabels } from "@/lib/climbs/labels";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import { SiteNav } from "@/components/site-nav";
import {
  MapView,
  type ClimbFeature,
  type StoredPath,
  type SuggestedFeature,
} from "./map-view";
import { lineStartPoint, lineStringOrNull } from "@/lib/tracks";
import {
  sourceAttribution,
  sourceAttributions,
} from "@/lib/importers/source-attribution";

export default async function MapPage() {
  const user = await requireUser();

  const [userClimbs, totalClimbs, { categorySuggestions }, routesWithPaths] = await Promise.all([
    prisma.climb.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        freeTextRouteName: true,
        gradeRaw: true,
        date: true,
        discipline: true,
        pathGeojson: true,
        pathSource: true,
        area: { select: { name: true } },
        route: {
          select: {
            name: true,
            lat: true,
            lng: true,
            area: { select: { name: true } },
          },
        },
      },
      orderBy: { date: "desc" },
    }),
    prisma.climb.count({ where: { userId: user.id } }),
    getUserProgressAndSuggestions(prisma, user),
    prisma.route.findMany({
      where: { pathSource: { not: null } },
      select: {
        id: true,
        name: true,
        pathGeojson: true,
        pathSource: true,
        externalSource: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);

  const features: ClimbFeature[] = userClimbs.flatMap((climb) => {
    const personalPath = lineStringOrNull(climb.pathGeojson);
    const point = personalPath
      ? lineStartPoint(personalPath)
      : climb.route?.lat !== null && climb.route?.lat !== undefined &&
          climb.route.lng !== null && climb.route.lng !== undefined
        ? { lat: climb.route.lat, lng: climb.route.lng }
        : null;
    if (!point) return [];
    return [{
      lat: point.lat,
      lng: point.lng,
      name: climb.route?.name || climb.freeTextRouteName,
      gradeRaw: climb.gradeRaw,
      date: climb.date.toISOString().slice(0, 10),
      discipline: disciplineLabels[climb.discipline],
      areaName: climb.route?.area?.name ?? climb.area?.name ?? null,
    }];
  });

  const paths: StoredPath[] = [];
  for (const climb of userClimbs) {
    const geometry = lineStringOrNull(climb.pathGeojson);
    if (!geometry) continue;
    paths.push({
      id: `climb-${climb.id}`,
      geometry,
      name: climb.freeTextRouteName,
      kind: "climb",
      source: climb.pathSource?.replaceAll("_", " ") ?? null,
    });
  }
  for (const route of routesWithPaths) {
    const geometry = lineStringOrNull(route.pathGeojson);
    if (!geometry) continue;
    paths.push({
      id: `route-${route.id}`,
      geometry,
      name: route.name,
      kind: "route",
      source: route.pathSource?.replaceAll("_", " ") ?? null,
      attribution: sourceAttribution(route.externalSource)?.attribution ?? null,
    });
  }
  const routeAttributions = sourceAttributions(
    routesWithPaths.map((route) => route.externalSource)
  );

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
            ? "No mappable climbs yet — draw/import a track or link a climb to a located route."
            : `${features.length} of ${totalClimbs} logged climbs have a track or representative location.`}
        </p>
      </div>

      <MapView climbs={features} suggested={suggested} paths={paths} />

      {routeAttributions.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Route data: {routeAttributions.map((item, index) => (
            <span key={item.label}>
              {index > 0 ? " · " : ""}
              <a href={item.sourceUrl} className="underline">{item.attribution}</a>
              {` (${item.licence})`}
            </span>
          ))}
        </p>
      )}

      {features.length < totalClimbs && (
        <p className="mt-3 text-xs text-muted-foreground">
          Climbs appear here when they have a drawn/imported track or are linked to a{" "}
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
