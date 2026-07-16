import type { PrismaClient } from "@/generated/prisma/client";
import { normaliseGrade } from "@/lib/grades";
import { generateLinkSuggestions } from "@/lib/matching";
import type { ExternalRoute, RouteImporter } from "./types";

// Sync runner: drives any RouteImporter, upserts Routes keyed on
// (external_source, external_id), and writes one RouteImportLog row per
// source per run (added/updated/errors). After all sources finish it
// refreshes climb→route link suggestions (surfaced in the UI, never
// auto-linked).

export type SyncOptions = {
  maxRoutesPerSource: number;
  log?: (message: string) => void;
};

export type SourceSyncResult = {
  source: string;
  added: number;
  updated: number;
  errors: { route?: string; message: string }[];
};

const MAX_LOGGED_ERRORS = 50;

async function findOrCreateArea(
  prisma: PrismaClient,
  cache: Map<string, string>,
  area: NonNullable<ExternalRoute["area"]>
): Promise<string> {
  const key = area.name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = await prisma.area.findFirst({
    where: { name: { equals: area.name, mode: "insensitive" } },
  });

  if (existing) {
    // Backfill region/country on name-only areas (from Phase 1 free text).
    if ((!existing.region && area.region) || (!existing.country && area.country)) {
      await prisma.area.update({
        where: { id: existing.id },
        data: {
          region: existing.region ?? area.region,
          country: existing.country ?? area.country,
        },
      });
    }
    cache.set(key, existing.id);
    return existing.id;
  }

  const created = await prisma.area.create({
    data: { name: area.name, region: area.region, country: area.country },
  });
  cache.set(key, created.id);
  return created.id;
}

async function syncSource(
  prisma: PrismaClient,
  importer: RouteImporter,
  options: SyncOptions
): Promise<SourceSyncResult> {
  const result: SourceSyncResult = {
    source: importer.source,
    added: 0,
    updated: 0,
    errors: [],
  };
  const areaCache = new Map<string, string>();

  try {
    for await (const route of importer.fetchRoutes({
      maxRoutes: options.maxRoutesPerSource,
      log: options.log,
    })) {
      try {
        const areaId = route.area
          ? await findOrCreateArea(prisma, areaCache, route.area)
          : null;

        const data = {
          name: route.name,
          discipline: route.discipline,
          gradeSystem: route.gradeSystem,
          gradeRaw: route.gradeRaw,
          gradeNormalisedScore:
            route.gradeSystem && route.gradeRaw
              ? normaliseGrade(route.gradeSystem, route.gradeRaw)
              : null,
          areaId,
          lat: route.lat,
          lng: route.lng,
          lengthM: route.lengthM,
          pitches: route.pitches,
          description: route.description,
          qualityRating: route.qualityRating,
          externalUrl: route.externalUrl,
          lastSyncedAt: new Date(),
        };

        const existing = await prisma.route.findUnique({
          where: {
            externalSource_externalId: {
              externalSource: importer.source,
              externalId: route.externalId,
            },
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.route.update({ where: { id: existing.id }, data });
          result.updated++;
        } else {
          await prisma.route.create({
            data: {
              ...data,
              externalSource: importer.source,
              externalId: route.externalId,
            },
          });
          result.added++;
        }
      } catch (error) {
        if (result.errors.length < MAX_LOGGED_ERRORS) {
          result.errors.push({
            route: `${route.externalId} ${route.name}`,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    // Source-level failure (network, API change): log it, keep the counts
    // for whatever was imported before the failure.
    result.errors.push({
      message: `source aborted: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  await prisma.routeImportLog.create({
    data: {
      source: importer.source,
      routesAdded: result.added,
      routesUpdated: result.updated,
      errorsJson: result.errors.length > 0 ? result.errors : undefined,
    },
  });

  return result;
}

export async function runSync(
  prisma: PrismaClient,
  importers: RouteImporter[],
  options: SyncOptions
): Promise<SourceSyncResult[]> {
  const results: SourceSyncResult[] = [];
  for (const importer of importers) {
    options.log?.(`--- syncing ${importer.source} ---`);
    results.push(await syncSource(prisma, importer, options));
  }

  options.log?.("--- refreshing climb→route link suggestions ---");
  const suggestions = await generateLinkSuggestions(prisma);
  options.log?.(`${suggestions} new link suggestion(s)`);

  return results;
}
