import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { GeometryCompleteness, ImportRunStatus, PathSource, RouteShape, SourceRecordStatus } from "@/generated/prisma/enums";
import { normaliseGrade } from "@/lib/grades";
import { generateLinkSuggestions } from "@/lib/matching";
import { lineStartPoint } from "@/lib/tracks";
import { decideCanonicalMatch, shouldApplyImportedField } from "./deduplication";
import { sourceAttribution } from "./source-attribution";
import { withEstimatedHikingDuration } from "./enrichment";
import type { ExternalRoute, ImporterCompletion, RouteImporter } from "./types";

export type SyncOptions = {
  maxRoutesPerSource: number;
  shard?: string;
  activity?: string;
  localFile?: string;
  resume?: boolean;
  resetCheckpoint?: boolean;
  log?: (message: string) => void;
};

export type SourceSyncResult = {
  source: string;
  shard: string;
  activity: string;
  added: number;
  updated: number;
  merged: number;
  suggested: number;
  stale: number;
  snapshotComplete: boolean;
  cursor: string | null;
  errors: { route?: string; code?: string; message: string }[];
};

const MAX_LOGGED_ERRORS = 50;

async function findOrCreateArea(
  prisma: PrismaClient,
  cache: Map<string, string>,
  area: NonNullable<ExternalRoute["area"]>
) {
  const key = `${area.name}|${area.country ?? ""}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = await prisma.area.findFirst({ where: { name: { equals: area.name, mode: "insensitive" } } });
  if (existing) {
    if ((!existing.region && area.region) || (!existing.country && area.country)) {
      await prisma.area.update({ where: { id: existing.id }, data: { region: existing.region ?? area.region, country: existing.country ?? area.country } });
    }
    cache.set(key, existing.id);
    return existing.id;
  }
  const created = await prisma.area.create({ data: { name: area.name, region: area.region, country: area.country } });
  cache.set(key, created.id);
  return created.id;
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;
}

function canonicalValues(route: ExternalRoute, areaId: string | null) {
  const start = route.pathGeojson ? lineStartPoint(route.pathGeojson) : null;
  return {
    name: route.name,
    discipline: route.discipline,
    gradeSystem: route.gradeSystem,
    gradeRaw: route.gradeRaw,
    gradeNormalisedScore: route.gradeSystem && route.gradeRaw ? normaliseGrade(route.gradeSystem, route.gradeRaw) : null,
    areaId,
    lat: route.lat ?? start?.lat ?? null,
    lng: route.lng ?? start?.lng ?? null,
    lengthM: route.lengthM ?? route.calculatedLengthM ?? null,
    calculatedLengthM: route.calculatedLengthM ?? null,
    ascentM: route.ascentM ?? null,
    descentM: route.descentM ?? null,
    calculatedAscentM: route.calculatedAscentM ?? null,
    estimatedDurationMins: route.estimatedDurationMins ?? route.calculatedDurationMins ?? null,
    calculatedDurationMins: route.calculatedDurationMins ?? null,
    routeShape: (route.routeShape ?? "unknown") as RouteShape,
    routeStatus: route.routeStatus ?? null,
    geometryCompleteness: (route.geometryCompleteness ?? "unknown") as GeometryCompleteness,
    geometrySegmentsJson: json(route.geometrySegments),
    localizedNamesJson: json(route.localizedNames),
    officialRef: route.officialRef ?? null,
    network: route.network ?? null,
    operator: route.operator ?? null,
    pitches: route.pitches,
    description: route.description,
    qualityRating: route.qualityRating,
    pathGeojson: json(route.pathGeojson),
    pathSource: route.pathGeojson ? PathSource.import : null,
    externalUrl: route.externalUrl,
    lastSyncedAt: new Date(),
  };
}

const IMPORTABLE_FIELDS = [
  "name", "discipline", "gradeSystem", "gradeRaw", "gradeNormalisedScore", "areaId", "lat", "lng",
  "lengthM", "calculatedLengthM", "ascentM", "descentM", "calculatedAscentM", "estimatedDurationMins",
  "calculatedDurationMins", "routeShape", "routeStatus", "geometryCompleteness", "geometrySegmentsJson",
  "localizedNamesJson", "officialRef", "network", "operator", "pitches", "description", "qualityRating",
  "pathGeojson", "pathSource", "externalUrl", "lastSyncedAt",
] as const;

function precedenceUpdate(existingMeta: unknown, values: ReturnType<typeof canonicalValues>, precedence: number, source: string) {
  const data: Record<string, unknown> = {};
  const meta = existingMeta && typeof existingMeta === "object"
    ? { ...(existingMeta as Record<string, unknown>) }
    : {};
  for (const field of IMPORTABLE_FIELDS) {
    if (!shouldApplyImportedField(existingMeta, field, precedence)) continue;
    // Absence is not authority: a higher-precedence source that omits a field
    // must not erase a useful lower-precedence/manual value.
    if (values[field] === null || values[field] === Prisma.DbNull) continue;
    data[field] = values[field];
    meta[field] = { source, precedence, importedAt: new Date().toISOString() };
  }
  data.canonicalFieldMetaJson = meta as Prisma.InputJsonValue;
  return data;
}

async function ingestRoute(
  prisma: PrismaClient,
  importer: RouteImporter,
  route: ExternalRoute,
  context: { shard: string; activity: string; snapshotId: string; areaCache: Map<string, string> }
) {
  const existingRecord = await prisma.routeSourceRecord.findUnique({
    where: { source_externalId: { source: importer.source, externalId: route.externalId } },
    include: { route: true },
  });
  // Routes imported before route_source_records was introduced still carry
  // their source identity on the canonical row. Adopt that row instead of
  // attempting to create a duplicate that violates the legacy compound key.
  const legacyRoute = existingRecord
    ? null
    : await prisma.route.findUnique({
        where: {
          externalSource_externalId: {
            externalSource: importer.source,
            externalId: route.externalId,
          },
        },
      });
  const areaId = route.area ? await findOrCreateArea(prisma, context.areaCache, route.area) : null;
  const values = canonicalValues(route, areaId);
  const precedence = importer.precedence ?? 100;
  let canonicalId: string;
  let outcome: "added" | "updated" | "merged" = "updated";
  let suggestedCandidateId: string | null = null;

  if (existingRecord) {
    canonicalId = existingRecord.routeId;
    await prisma.route.update({
      where: { id: canonicalId },
      data: precedenceUpdate(existingRecord.route.canonicalFieldMetaJson, values, precedence, importer.source),
    });
  } else if (legacyRoute) {
    canonicalId = legacyRoute.id;
    await prisma.route.update({
      where: { id: canonicalId },
      data: precedenceUpdate(legacyRoute.canonicalFieldMetaJson, values, precedence, importer.source),
    });
  } else {
    const candidates = await prisma.route.findMany({
      where: { discipline: route.discipline },
      include: { area: true, sourceRecords: { select: { externalUrl: true, rawMetadataJson: true } } },
      orderBy: { updatedAt: "desc" },
      take: 250,
    });
    const decision = decideCanonicalMatch(route, candidates);
    if (decision.kind === "merge" && decision.candidateId) {
      canonicalId = decision.candidateId;
      const candidate = candidates.find((value) => value.id === canonicalId)!;
      await prisma.route.update({ where: { id: canonicalId }, data: precedenceUpdate(candidate.canonicalFieldMetaJson, values, precedence, importer.source) });
      outcome = "merged";
    } else {
      const fieldMeta = Object.fromEntries(IMPORTABLE_FIELDS.map((field) => [field, { source: importer.source, precedence, importedAt: new Date().toISOString() }]));
      const created = await prisma.route.create({
        data: {
          ...values,
          canonicalFieldMetaJson: fieldMeta,
          externalSource: importer.source,
          externalId: route.externalId,
        },
      });
      canonicalId = created.id;
      outcome = "added";
      if (decision.kind === "suggest" && decision.candidateId) suggestedCandidateId = decision.candidateId;
    }
  }

  const registry = sourceAttribution(importer.source);
  await prisma.routeSourceRecord.upsert({
    where: { source_externalId: { source: importer.source, externalId: route.externalId } },
    create: {
      routeId: canonicalId,
      source: importer.source,
      sourceShard: context.shard,
      sourceActivity: context.activity,
      externalId: route.externalId,
      externalUrl: route.externalUrl,
      licence: route.licence ?? importer.defaultLicence ?? registry?.licence ?? "Licence not registered",
      licenceUrl: route.licenceUrl ?? importer.defaultLicenceUrl ?? registry?.licenceUrl,
      attribution: route.attribution ?? importer.defaultAttribution ?? registry?.attribution ?? importer.source,
      rawMetadataJson: json(route.rawMetadata),
      fieldProvenanceJson: json({ difficulty: route.difficultyDerivation, calculatedLength: route.calculatedLengthM !== null && route.calculatedLengthM !== undefined, calculatedAscent: route.calculatedAscentM !== null && route.calculatedAscentM !== undefined, calculatedDuration: route.calculatedDurationMins !== null && route.calculatedDurationMins !== undefined }),
      sourceUpdatedAt: route.sourceUpdatedAt,
      importSnapshot: context.snapshotId,
      importCheckpoint: route.importCursor,
      geometryGeojson: json(route.pathGeojson),
      geometryCompleteness: (route.geometryCompleteness ?? "unknown") as GeometryCompleteness,
      geometrySegmentsJson: json(route.geometrySegments),
      sourceName: route.name,
      sourceGradeRaw: route.gradeRaw,
      sourceDistanceM: route.lengthM,
      sourceAscentM: route.ascentM,
      sourceDescentM: route.descentM,
    },
    update: {
      routeId: canonicalId,
      sourceShard: context.shard,
      sourceActivity: context.activity,
      externalUrl: route.externalUrl,
      licence: route.licence ?? importer.defaultLicence ?? registry?.licence ?? "Licence not registered",
      licenceUrl: route.licenceUrl ?? importer.defaultLicenceUrl ?? registry?.licenceUrl,
      attribution: route.attribution ?? importer.defaultAttribution ?? registry?.attribution ?? importer.source,
      rawMetadataJson: json(route.rawMetadata),
      fieldProvenanceJson: json({ difficulty: route.difficultyDerivation, calculatedLength: route.calculatedLengthM !== null && route.calculatedLengthM !== undefined, calculatedAscent: route.calculatedAscentM !== null && route.calculatedAscentM !== undefined, calculatedDuration: route.calculatedDurationMins !== null && route.calculatedDurationMins !== undefined }),
      sourceUpdatedAt: route.sourceUpdatedAt,
      lastSeenAt: new Date(),
      importSnapshot: context.snapshotId,
      importCheckpoint: route.importCursor,
      geometryGeojson: json(route.pathGeojson),
      geometryCompleteness: (route.geometryCompleteness ?? "unknown") as GeometryCompleteness,
      geometrySegmentsJson: json(route.geometrySegments),
      sourceName: route.name,
      sourceGradeRaw: route.gradeRaw,
      sourceDistanceM: route.lengthM,
      sourceAscentM: route.ascentM,
      sourceDescentM: route.descentM,
      status: SourceRecordStatus.active,
      staleAt: null,
    },
  });

  if (suggestedCandidateId) {
    const decision = decideCanonicalMatch(route, await prisma.route.findMany({ where: { id: suggestedCandidateId }, include: { area: true, sourceRecords: { select: { externalUrl: true, rawMetadataJson: true } } } }));
    await prisma.routeMergeSuggestion.upsert({
      where: { source_externalId_candidateRouteId: { source: importer.source, externalId: route.externalId, candidateRouteId: suggestedCandidateId } },
      create: { source: importer.source, externalId: route.externalId, primaryRouteId: canonicalId, candidateRouteId: suggestedCandidateId, score: decision.score, reasonsJson: decision.reasons },
      update: { score: decision.score, reasonsJson: decision.reasons },
    });
  }
  return { outcome, suggested: Boolean(suggestedCandidateId) };
}

export async function syncSource(prisma: PrismaClient, importer: RouteImporter, options: SyncOptions): Promise<SourceSyncResult> {
  const shard = options.shard ?? (importer.source === "osm_geofabrik" ? "uk-england" : "default");
  const activity = options.activity ?? "all";
  const result: SourceSyncResult = { source: importer.source, shard, activity, added: 0, updated: 0, merged: 0, suggested: 0, stale: 0, snapshotComplete: false, cursor: null, errors: [] };
  const checkpoint = await prisma.routeImportCheckpoint.findUnique({
    where: { source_shard_activity: { source: importer.source, shard, activity } },
  });
  const cursorStart = options.resetCheckpoint ? null : options.resume === false ? null : checkpoint?.cursor ?? null;
  const snapshotId = options.resetCheckpoint || !checkpoint?.snapshotId ? crypto.randomUUID() : checkpoint.snapshotId;
  let completion: ImporterCompletion | void = undefined;
  let lastSuccessfulCursor = cursorStart;
  const areaCache = new Map<string, string>();
  try {
    const iterator = importer.fetchRoutes({ maxRoutes: options.maxRoutesPerSource, cursor: cursorStart, shard, activity, snapshotId, localFile: options.localFile, log: options.log });
    while (true) {
      const item = await iterator.next();
      if (item.done) { completion = item.value; break; }
      const route = withEstimatedHikingDuration(item.value);
      try {
        const ingested = await ingestRoute(prisma, importer, route, { shard, activity, snapshotId, areaCache });
        result[ingested.outcome]++;
        if (ingested.suggested) result.suggested++;
        lastSuccessfulCursor = route.importCursor ?? lastSuccessfulCursor;
      } catch (error) {
        if (result.errors.length < MAX_LOGGED_ERRORS) result.errors.push({ route: `${route.externalId} ${route.name}`, code: "RECORD_IMPORT_FAILED", message: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    result.errors.push({ code: "SOURCE_ABORTED", message: `source aborted: ${error instanceof Error ? error.message : String(error)}` });
  }

  const runSucceeded = result.errors.length === 0;
  result.snapshotComplete = Boolean(runSucceeded && completion?.snapshotComplete);
  result.cursor = runSucceeded ? completion?.nextCursor ?? null : lastSuccessfulCursor;
  if (result.snapshotComplete) {
    const stale = await prisma.routeSourceRecord.updateMany({
      where: { source: importer.source, sourceShard: shard, sourceActivity: activity, status: SourceRecordStatus.active, NOT: { importSnapshot: completion!.snapshotId } },
      data: { status: SourceRecordStatus.stale, staleAt: new Date() },
    });
    result.stale = stale.count;
  }
  if (runSucceeded) {
    await prisma.routeImportCheckpoint.upsert({
      where: { source_shard_activity: { source: importer.source, shard, activity } },
      create: { source: importer.source, shard, activity, cursor: result.cursor, snapshotId: result.snapshotComplete ? null : completion?.snapshotId ?? snapshotId, etag: completion?.etag, checksum: completion?.checksum, stateJson: json(completion?.state), lastSuccessAt: new Date() },
      update: { cursor: result.cursor, snapshotId: result.snapshotComplete ? null : completion?.snapshotId ?? snapshotId, etag: completion?.etag, checksum: completion?.checksum, stateJson: json(completion?.state), lastSuccessAt: new Date() },
    });
  }
  await prisma.routeImportLog.create({
    data: {
      source: importer.source, shard, activity, routesAdded: result.added, routesUpdated: result.updated,
      routesMerged: result.merged, suggestionsCreated: result.suggested, routesStale: result.stale,
      snapshotId: completion?.snapshotId ?? snapshotId, cursorStart, cursorEnd: result.cursor,
      snapshotComplete: result.snapshotComplete,
      status: runSucceeded ? ImportRunStatus.succeeded : (result.added + result.updated + result.merged > 0 ? ImportRunStatus.partial : ImportRunStatus.failed),
      finishedAt: new Date(), errorsJson: result.errors.length ? result.errors : undefined,
    },
  });
  return result;
}

export async function runSync(prisma: PrismaClient, importers: RouteImporter[], options: SyncOptions) {
  const results: SourceSyncResult[] = [];
  for (const importer of importers) {
    options.log?.(`--- syncing ${importer.source} (${options.shard ?? "default"}/${options.activity ?? "all"}) ---`);
    results.push(await syncSource(prisma, importer, options));
  }
  options.log?.("--- refreshing climb→route link suggestions ---");
  const suggestions = await generateLinkSuggestions(prisma);
  options.log?.(`${suggestions} new link suggestion(s)`);
  return results;
}

export async function importHealthReport(prisma: PrismaClient) {
  return prisma.routeImportLog.findMany({ orderBy: { runAt: "desc" }, take: 100 });
}
