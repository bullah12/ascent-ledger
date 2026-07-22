import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import overpassFixture from "./fixtures/overpass.json";
import nationalTrailsFixture from "./fixtures/national-trails.json";
import greatTrailsFixture from "./fixtures/great-trails.json";
import { createOsmOverpassImporter } from "./osm-overpass";
import { createNationalTrailsImporter } from "./uk-national-trails";
import { createNatureScotGreatTrailsImporter } from "./scotlands-great-trails";
import { sourceAttribution } from "./source-attribution";
import { syncSource } from "./sync";
import type { RouteImporter } from "./types";
import { routeInputFingerprint, ROUTE_QUALITY_POLICY_VERSION } from "@/lib/routes/quality-policy";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

async function collect(importer: RouteImporter, maxRoutes = 20) {
  const routes = [];
  for await (const route of importer.fetchRoutes({ maxRoutes })) routes.push(route);
  return routes;
}

describe("Phase 9 route importers", () => {
  it("parses Overpass hiking and via-ferrata geometry, SAC grade, attribution, and cap", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(overpassFixture));
    const importer = createOsmOverpassImporter({
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => undefined,
      scopes: [{ key: "fixture", bbox: "50,-5,51,-4" }],
    });
    const routes = await collect(importer, 1);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      externalId: "relation/101",
      discipline: "hiking",
      gradeSystem: "sac_hiking",
      gradeRaw: "T3",
    });
    expect(routes[0].pathGeojson?.coordinates).toHaveLength(3);
    expect(sourceAttribution(importer.source)?.attribution).toBe("© OpenStreetMap contributors");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses agency GeoJSON without inventing joins and respects maxRoutes", async () => {
    const importer = createNationalTrailsImporter({
      source: "national_trails_england",
      country: "England",
      endpoint: "https://fixture.invalid/trails",
      fetchImpl: (async () => jsonResponse(nationalTrailsFixture)) as typeof fetch,
    });
    const routes = await collect(importer, 1);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      externalId: "eng-1",
      name: "Fixture National Trail",
      discipline: "hiking",
      lengthM: 12500,
    });
    expect(routes[0].pathGeojson?.coordinates).toHaveLength(3);
    expect(sourceAttribution(importer.source)?.licence).toContain("Open Government");
  });

  it("parses Wales National Trails as a separately attributable source", async () => {
    const importer = createNationalTrailsImporter({
      source: "national_trails_wales",
      country: "Wales",
      endpoint: "https://fixture.invalid/wales-trails",
      fetchImpl: (async () => jsonResponse(nationalTrailsFixture)) as typeof fetch,
    });
    const routes = await collect(importer, 1);
    expect(routes[0]).toMatchObject({
      externalId: "eng-1",
      discipline: "hiking",
      area: { region: "Wales" },
    });
    expect(sourceAttribution(importer.source)?.attribution).toContain(
      "Natural Resources Wales"
    );
  });

  it("loads a configured official NatureScot distribution and fails clearly when absent", async () => {
    const importer = createNatureScotGreatTrailsImporter({
      dataUrl: "https://fixture.invalid/great-trails.geojson",
      licence: "Open Government Licence v3.0",
      fetchImpl: (async () => jsonResponse(greatTrailsFixture)) as typeof fetch,
    });
    const routes = await collect(importer);
    expect(routes[0]).toMatchObject({
      externalId: "sgt-fixture-1",
      discipline: "hiking",
      lengthM: 24000,
    });
    await expect(collect(createNatureScotGreatTrailsImporter({ dataUrl: "" }))).rejects.toThrow(
      "NATURESCOT_TRAILS_GEOJSON_URL"
    );
  });

  it("records a source failure without preventing the next source", async () => {
    const logs: unknown[] = [];
    const createdRoutes: unknown[] = [];
    const markStale = vi.fn(async () => ({ count: 0 }));
    const fakePrisma = {
      routeImportLog: { create: async (value: unknown) => logs.push(value) },
      routeImportCheckpoint: {
        findUnique: async () => null,
        upsert: async () => undefined,
      },
      routeSourceRecord: {
        findUnique: async () => null,
        upsert: async () => undefined,
        updateMany: markStale,
      },
      routeMergeSuggestion: { upsert: async () => undefined },
      route: {
        findUnique: async () => null,
        findMany: async () => [],
        update: async () => undefined,
        create: async (value: unknown) => {
          createdRoutes.push(value);
          return { id: "route-fixture" };
        },
      },
    } as unknown as PrismaClient;
    const failed: RouteImporter = {
      source: "failed_fixture",
      async *fetchRoutes() { throw new Error("temporary outage"); },
    };
    const healthy: RouteImporter = {
      source: "healthy_fixture",
      async *fetchRoutes() {
        yield {
          externalId: "one",
          externalUrl: "https://fixture.invalid/one",
          name: "Healthy route",
          discipline: "hiking",
          gradeSystem: "sac_hiking",
          gradeRaw: "T1",
          lat: 50,
          lng: -2,
          lengthM: null,
          calculatedLengthM: 12_000,
          pitches: null,
          description: null,
          pathGeojson: {
            type: "LineString",
            coordinates: [[-2, 50], [-1.9, 50.1]],
          },
          qualityRating: null,
          area: null,
        };
      },
    };
    const options = { maxRoutesPerSource: 10 };
    const first = await syncSource(fakePrisma, failed, options);
    const second = await syncSource(fakePrisma, healthy, options);
    expect(first.errors[0].message).toContain("source aborted");
    expect(markStale).not.toHaveBeenCalled();
    expect(second).toMatchObject({ added: 1, updated: 0, errors: [] });
    expect(logs).toHaveLength(2);
    expect(createdRoutes).toHaveLength(1);
    expect(createdRoutes[0]).toMatchObject({
      data: { pathSource: "import", lat: 50, lng: -2 },
    });
  });

  it("adopts a legacy canonical route when its source record is missing", async () => {
    const updateRoute = vi.fn(async () => undefined);
    const upsertSourceRecord = vi.fn(async () => undefined);
    const createRoute = vi.fn();
    const legacyRoute = {
      id: "legacy-route",
      canonicalFieldMetaJson: null,
    };
    const fakePrisma = {
      routeImportLog: { create: async () => undefined },
      routeImportCheckpoint: {
        findUnique: async () => null,
        upsert: async () => undefined,
      },
      routeSourceRecord: {
        findUnique: async () => null,
        upsert: upsertSourceRecord,
        updateMany: async () => ({ count: 0 }),
      },
      routeMergeSuggestion: { upsert: async () => undefined },
      route: {
        findUnique: vi.fn(async () => legacyRoute),
        findMany: async () => [],
        update: updateRoute,
        create: createRoute,
      },
    } as unknown as PrismaClient;
    const importer: RouteImporter = {
      source: "osm_geofabrik",
      async *fetchRoutes() {
        yield {
          externalId: "relation/3998335",
          externalUrl: "https://www.openstreetmap.org/relation/3998335",
          name: "Lawena - Wangerberg",
          discipline: "hiking",
          gradeSystem: null,
          gradeRaw: null,
          lat: 47.1,
          lng: 9.5,
          lengthM: null,
          calculatedLengthM: 12_000,
          pitches: null,
          description: null,
          pathGeojson: { type: "LineString", coordinates: [[9.5, 47.1], [9.6, 47.2]] },
          geometryCompleteness: "complete",
          officialRef: "LWW-1",
          network: "rwn",
          operator: "Liechtenstein trail authority",
          rawMetadata: { tags: { type: "route", route: "hiking", network: "rwn", ref: "LWW-1", operator: "Liechtenstein trail authority" } },
          qualityRating: null,
          area: null,
        };
      },
    };

    const result = await syncSource(fakePrisma, importer, { maxRoutesPerSource: 10 });

    expect(result).toMatchObject({ added: 0, updated: 1, errors: [] });
    expect(fakePrisma.route.findUnique).toHaveBeenCalledWith({
      where: {
        externalSource_externalId: {
          externalSource: "osm_geofabrik",
          externalId: "relation/3998335",
        },
      },
    });
    expect(updateRoute).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "legacy-route" },
    }));
    expect(upsertSourceRecord).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ routeId: "legacy-route" }),
    }));
    expect(createRoute).not.toHaveBeenCalled();
  });

  it("marks missing records stale only after a successful complete snapshot", async () => {
    const markStale = vi.fn(async () => ({ count: 2 }));
    const fakePrisma = {
      routeImportLog: { create: async () => undefined },
      routeImportCheckpoint: { findUnique: async () => null, upsert: async () => undefined },
      routeSourceRecord: { updateMany: markStale },
    } as unknown as PrismaClient;
    const complete: RouteImporter = {
      source: "complete_fixture",
      async *fetchRoutes() {
        return { nextCursor: null, snapshotId: "snapshot-1", snapshotComplete: true };
      },
    };
    const result = await syncSource(fakePrisma, complete, { maxRoutesPerSource: 10 });
    expect(result).toMatchObject({ snapshotComplete: true, stale: 2, errors: [] });
    expect(markStale).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ NOT: { importSnapshot: "snapshot-1" } }),
    }));
  });

  it("counts and retains a rejected OSM standalone way without creating a canonical route", async () => {
    const upsertSourceRecord = vi.fn(async () => undefined);
    const createRoute = vi.fn();
    const fakePrisma = {
      routeImportLog: { create: async () => undefined },
      routeImportCheckpoint: { findUnique: async () => null, upsert: async () => undefined },
      routeSourceRecord: { findUnique: async () => null, upsert: upsertSourceRecord, updateMany: async () => ({ count: 0 }) },
      route: { findUnique: async () => null, create: createRoute, update: vi.fn() },
    } as unknown as PrismaClient;
    const importer: RouteImporter = {
      source: "osm_geofabrik",
      async *fetchRoutes() {
        yield {
          externalId: "way/99", externalUrl: "https://www.openstreetmap.org/way/99",
          name: "Someone's morning walk", discipline: "hiking", gradeSystem: null,
          gradeRaw: null, lat: null, lng: null, lengthM: null, calculatedLengthM: 4_000,
          pitches: null, description: null, qualityRating: null,
          pathGeojson: { type: "LineString", coordinates: [[0, 0], [0.04, 0.04]] },
          geometryCompleteness: "complete", rawMetadata: { tags: { highway: "path" } }, area: null,
        };
      },
    };
    const result = await syncSource(fakePrisma, importer, { maxRoutesPerSource: 10 });
    expect(result).toMatchObject({ accepted: 0, quarantined: 0, rejected: 1, added: 0, errors: [] });
    expect(createRoute).not.toHaveBeenCalled();
    expect(upsertSourceRecord).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ routeId: null, publicationState: "rejected", decisionReasons: ["OSM_STANDALONE_WAY"] }),
    }));
  });

  it("resumes past an unchanged rejected source record without reconsidering or duplicating it", async () => {
    const candidate = {
      externalId: "way/100", externalUrl: "https://www.openstreetmap.org/way/100",
      name: "Unverified path", discipline: "hiking" as const, gradeSystem: null,
      gradeRaw: null, lat: null, lng: null, lengthM: null, calculatedLengthM: 4_000,
      pitches: null, description: null, qualityRating: null,
      pathGeojson: { type: "LineString" as const, coordinates: [[0, 0], [0.04, 0.04]] },
      geometryCompleteness: "complete" as const, rawMetadata: { tags: { highway: "path" } }, area: null,
    };
    const refresh = vi.fn(async () => undefined);
    const findLegacy = vi.fn();
    const upsert = vi.fn();
    const fakePrisma = {
      routeImportLog: { create: async () => undefined },
      routeImportCheckpoint: { findUnique: async () => null, upsert: async () => undefined },
      routeSourceRecord: {
        findUnique: async () => ({ id: "source-100", routeId: null, route: null, publicationState: "rejected", policyVersion: ROUTE_QUALITY_POLICY_VERSION, inputFingerprint: routeInputFingerprint("osm_geofabrik", candidate) }),
        update: refresh, upsert, updateMany: async () => ({ count: 0 }),
      },
      route: { findUnique: findLegacy },
    } as unknown as PrismaClient;
    const importer: RouteImporter = { source: "osm_geofabrik", async *fetchRoutes() { yield candidate; } };
    const result = await syncSource(fakePrisma, importer, { maxRoutesPerSource: 10 });
    expect(result).toMatchObject({ rejected: 1, added: 0, updated: 0, errors: [] });
    expect(refresh).toHaveBeenCalledOnce();
    expect(findLegacy).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
