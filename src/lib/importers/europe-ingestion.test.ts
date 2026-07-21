import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import Pbf from "pbf";
import { describe, expect, it } from "vitest";
import { assembleOrderedRelationGeometry } from "./geometry";
import { decideCanonicalMatch, shouldApplyImportedField } from "./deduplication";
import { calculateDemAscent, estimateHikingDurationMinutes } from "./enrichment";
import { camptocampRoute, createCamptocampImporter } from "./camptocamp";
import { extractOsmRoutesFromPbf } from "./osm-geofabrik";
import { GEOFABRIK_EUROPE_SHARDS } from "./geofabrik-registry";
import { hardestSacScale, normaliseSacScale } from "./osm-sac";
import { parseGreatTrailFeature } from "./scotlands-great-trails";
import { parseOfficialRouteFeature } from "./official-sources";
import { sourceAttribution } from "./source-attribution";
import { parseDatatourismeTour } from "./datatourisme";
import type { ExternalRoute } from "./types";

function writeStringTable(strings: string[], pbf: Pbf) {
  for (const value of strings) { pbf.writeTag(1, 2); pbf.writeString(value); }
}

type NodeFixture = { id: number; lat: number; lon: number };
function writeNode(node: NodeFixture, pbf: Pbf) {
  pbf.writeTag(1, 0); pbf.writeSVarint(node.id);
  pbf.writeTag(8, 0); pbf.writeSVarint(Math.round(node.lat * 1e7));
  pbf.writeTag(9, 0); pbf.writeSVarint(Math.round(node.lon * 1e7));
}

type WayFixture = { id: number; refs: number[]; keys: number[]; values: number[] };
function writeWay(way: WayFixture, pbf: Pbf) {
  pbf.writeTag(1, 0); pbf.writeVarint(way.id);
  pbf.writePackedVarint(2, way.keys); pbf.writePackedVarint(3, way.values);
  let previous = 0;
  pbf.writePackedSVarint(8, way.refs.map((ref) => { const delta = ref - previous; previous = ref; return delta; }));
}

type RelationFixture = { id: number; keys: number[]; values: number[]; refs: number[]; roles: number[]; types: number[] };
function writeRelation(relation: RelationFixture, pbf: Pbf) {
  pbf.writeTag(1, 0); pbf.writeVarint(relation.id);
  pbf.writePackedVarint(2, relation.keys); pbf.writePackedVarint(3, relation.values);
  pbf.writePackedVarint(8, relation.roles);
  let previous = 0;
  pbf.writePackedSVarint(9, relation.refs.map((ref) => { const delta = ref - previous; previous = ref; return delta; }));
  pbf.writePackedVarint(10, relation.types);
}

function writeGroup(value: { nodes: NodeFixture[]; ways: WayFixture[]; relations: RelationFixture[] }, pbf: Pbf) {
  for (const node of value.nodes) pbf.writeMessage(1, writeNode, node);
  for (const way of value.ways) pbf.writeMessage(3, writeWay, way);
  for (const relation of value.relations) pbf.writeMessage(4, writeRelation, relation);
}

function writePrimitiveBlock(value: { strings: string[]; group: Parameters<typeof writeGroup>[0] }, pbf: Pbf) {
  pbf.writeMessage(1, writeStringTable, value.strings);
  pbf.writeMessage(2, writeGroup, value.group);
  pbf.writeTag(17, 0); pbf.writeVarint(100);
}

function bytesMessage(tag: number, bytes: Uint8Array, pbf: Pbf) {
  pbf.writeTag(tag, 2); pbf.writeBytes(bytes);
}

function writeBlobHeader(value: { size: number }, pbf: Pbf) {
  pbf.writeTag(1, 2); pbf.writeString("OSMData");
  pbf.writeTag(3, 0); pbf.writeVarint(value.size);
}

async function pbfFixture() {
  const strings = ["", "name", "Fixture Trail", "type", "route", "hiking", "sac_scale", "mountain_hiking", "Fixture Ferrata", "highway", "via_ferrata", "3", "via_ferrata_scale"];
  const primitive = new Pbf();
  writePrimitiveBlock({
    strings,
    group: {
      nodes: [
        { id: 1, lat: 50, lon: -2 }, { id: 2, lat: 50.01, lon: -1.99 },
        { id: 3, lat: 50.02, lon: -1.98 }, { id: 4, lat: 50.03, lon: -1.97 },
      ],
      ways: [
        { id: 10, refs: [1, 2], keys: [6], values: [7] },
        { id: 11, refs: [2, 3], keys: [], values: [] },
        { id: 20, refs: [3, 4], keys: [1, 9, 12], values: [8, 10, 11] },
      ],
      relations: [{ id: 100, keys: [1, 3, 4], values: [2, 4, 5], refs: [10, 11], roles: [0, 0], types: [1, 1] }],
    },
  }, primitive);
  const compressed = deflateSync(primitive.finish());
  const blob = new Pbf();
  bytesMessage(3, compressed, blob);
  const blobBytes = blob.finish();
  const header = new Pbf();
  writeBlobHeader({ size: blobBytes.length }, header);
  const headerBytes = header.finish();
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(headerBytes.length);
  const directory = await mkdtemp(join(tmpdir(), "ascent-pbf-"));
  const path = join(directory, "fixture.osm.pbf");
  await writeFile(path, Buffer.concat([prefix, headerBytes, blobBytes]));
  return path;
}

const baseRoute = (overrides: Partial<ExternalRoute> = {}): ExternalRoute => ({
  externalId: "source-1", externalUrl: "https://source.invalid/1", name: "West Highland Way",
  discipline: "hiking", gradeSystem: null, gradeRaw: null, lat: 56.8, lng: -5,
  lengthM: null, pitches: null, description: null, qualityRating: null,
  area: { name: "Scotland", region: "Scotland", country: "United Kingdom" }, ...overrides,
});

describe("Europe ingestion primitives", () => {
  it("uses unique bounded Geofabrik shards rather than the whole-Europe or oversized France/Germany extracts", () => {
    const keys = GEOFABRIK_EUROPE_SHARDS.map((shard) => shard.key);
    const paths = GEOFABRIK_EUROPE_SHARDS.map((shard) => shard.path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(paths).not.toContain("europe");
    expect(keys).not.toContain("france");
    expect(keys).not.toContain("germany");
    expect(keys).toContain("russia");
    expect(keys).toContain("guernsey-jersey");
  });

  it.each([
    ["strolling", "T1"], ["hiking", "T1"], ["mountain_hiking", "T2"],
    ["demanding_mountain_hiking", "T3"], ["alpine_hiking", "T4"],
    ["demanding_alpine_hiking", "T5"], ["difficult_alpine_hiking", "T6"],
  ])("maps OSM SAC %s to %s", (raw, expected) => expect(normaliseSacScale(raw)).toBe(expected));

  it("derives the hardest member-way SAC grade and retains raw values", () => {
    expect(hardestSacScale(["hiking", "demanding_alpine_hiking", "mountain_hiking"]))
      .toEqual({ gradeRaw: "T5", rawValues: ["hiking", "demanding_alpine_hiking", "mountain_hiking"] });
  });

  it("preserves ordered main, alternative, disconnected, and clipped relation geometry", () => {
    const assembled = assembleOrderedRelationGeometry([
      { type: "way", ref: 1, role: "", coordinates: [[0, 0], [1, 0]] },
      { type: "way", ref: 2, role: "", coordinates: [[1, 0], [2, 0]] },
      { type: "way", ref: 3, role: "alternative", coordinates: [[1, 0], [1, 1]] },
      { type: "way", ref: 4, role: "", coordinates: [[5, 5], [6, 6]], clipped: true },
    ]);
    expect(assembled.canonical?.coordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(assembled.segments).toHaveLength(4);
    expect(assembled.segments[2].role).toBe("alternative");
    expect(assembled.completeness).toBe("clipped");
  });

  it("parses a real PBF fixture and advances its shard cursor without restarting", async () => {
    const file = await pbfFixture();
    const first = await extractOsmRoutesFromPbf({ file, shardKey: "uk-england", maxRoutes: 1 });
    expect(first.routes[0]).toMatchObject({ externalId: "way/20", discipline: "via_ferrata", gradeRaw: "3" });
    expect(first.completion).toMatchObject({ nextCursor: "1", snapshotComplete: false });
    const second = await extractOsmRoutesFromPbf({ file, shardKey: "uk-england", maxRoutes: 1, cursor: first.completion.nextCursor });
    expect(second.routes[0]).toMatchObject({ externalId: "relation/100", gradeRaw: "T2" });
    expect(second.routes[0].pathGeojson?.coordinates).toHaveLength(3);
    expect(second.completion.snapshotComplete).toBe(true);
  });

  it("maps Camptocamp vertical height to ascent, never route length", () => {
    const route = camptocampRoute({ document_id: 1, locales: [{ lang: "en", title: "Rock route" }], activities: ["rock_climbing"], geometry: null, areas: [], quality: "fine", french_free: "6a", height_diff_up: 420 }, "rock_climbing");
    expect(route).toMatchObject({ discipline: "rock", gradeRaw: "6a", ascentM: 420, lengthM: null });
  });

  it("progresses Camptocamp activity/shard cursors instead of restarting at zero", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ documents: [{ document_id: 1, locales: [{ lang: "en", title: "Route" }], activities: ["rock_climbing"], geometry: null, areas: [], quality: "fine", french_free: "6a" }] }), { status: 200 });
    }) as typeof fetch;
    const importer = createCamptocampImporter({ fetchImpl, sleepImpl: async () => undefined });
    const iterator = importer.fetchRoutes({ maxRoutes: 1, activity: "rock_climbing", shard: "123", cursor: JSON.stringify({ rock_climbing: 40 }) });
    await iterator.next();
    await iterator.return(undefined);
    expect(requested[0]).toContain("act=rock_climbing");
    expect(requested[0]).toContain("offset=40");
    expect(requested[0]).toContain("area=123");
  });

  it("accepts NatureScot's public distribution field names", () => {
    const route = parseGreatTrailFeature({ type: "Feature", properties: { OBJECTID: 7, Trail: "Speyside Way", Kilometers: 137, Website: "https://www.nature.scot/example", Description: "Official trail" }, geometry: { type: "LineString", coordinates: [[-3, 57], [-3.1, 57.1]] } });
    expect(route).toMatchObject({ externalId: "7", name: "Speyside Way", lengthM: 137000, description: "Official trail" });
  });

  it.each([
    ["england_coast_path", "United Kingdom", "Open Government Licence v3.0"],
    ["sweden_naturvardsverket", "Sweden", "CC0 1.0"],
    ["finland_lipas", "Finland", "CC BY 4.0"],
    ["norway_kartverket_trails", "Norway", "NLOD 2.0"],
    ["swiss_wanderland", "Switzerland", "opendata.swiss open use"],
  ])("parses the %s official fixture", (source, country, licence) => {
    const route = parseOfficialRouteFeature({ type: "Feature", id: `${source}-1`, properties: { name: `${country} Trail`, activity: "hiking", owner: "Fixture owner" }, geometry: { type: "LineString", coordinates: [[10, 60], [10.1, 60.1]] } }, { source, sourceUrl: "https://source.invalid", country, licence, licenceUrl: "https://licence.invalid", attribution: "Fixture authority", label: `${country} routes` });
    expect(route).toMatchObject({ name: `${country} Trail`, discipline: "hiking", licence, attribution: "Fixture authority" });
  });

  it("uses Naturvårdsverket's published trail field names and metre units", () => {
    const config = { source: "sweden_naturvardsverket", sourceUrl: "https://source.invalid", country: "Sweden", licence: "CC0 1.0", licenceUrl: "https://licence.invalid", attribution: "Naturvårdsverket", label: "Swedish trails" };
    const route = parseOfficialRouteFeature({ type: "Feature", properties: { L_ID: "se-1", LNAMN: "Kungsleden", LTYP: "Vandringsled", BESKRIVN: "Fjäll-led", LLANGD: 440000 }, geometry: { type: "LineString", coordinates: [[18, 68], [18.1, 68.1]] } }, config);
    expect(route).toMatchObject({ externalId: "se-1", name: "Kungsleden", discipline: "hiking", description: "Fjäll-led", lengthM: 440000 });
    const cycleRoute = parseOfficialRouteFeature({ type: "Feature", properties: { L_ID: "se-2", LNAMN: "Cykelleden", LTYP: "Cykelled" }, geometry: { type: "LineString", coordinates: [[18, 68], [18.1, 68.1]] } }, config);
    expect(cycleRoute).toBeNull();
  });

  it("parses a DATAtourisme TOUR record with producer and update attribution", () => {
    const route = parseDatatourismeTour({
      "@id": "https://data.example/tour/1",
      "@type": ["Tour", "HikingTour"],
      "rdfs:label": [{ "@value": "Tour du Mont Test", "@language": "en" }],
      hasBeenCreatedBy: { "@value": "Office de Tourisme Test" },
      lastUpdate: "2026-01-02T00:00:00Z",
      geojson: { type: "LineString", coordinates: [[6, 45], [6.1, 45.1]] },
    });
    expect(route).toMatchObject({ discipline: "hiking", operator: "Office de Tourisme Test", licence: "Etalab Open Licence 2.0" });
    expect(route?.attribution).toContain("2026-01-02");
  });

  it("renders registered source-specific attribution", () => {
    expect(sourceAttribution("england_coast_path")).toMatchObject({ licence: "Open Government Licence v3.0" });
    expect(sourceAttribution("finland_lipas")?.attribution).toContain("Lipas.fi");
  });

  it("auto-merges strong geographic name matches, suggests weaker ones, and avoids false positives", () => {
    const candidate = { id: "canonical", name: "West Highland Way", discipline: "hiking", lat: 56.8005, lng: -5.0005, area: { name: "Scotland", region: "Scotland", country: "United Kingdom" }, sourceRecords: [] };
    expect(decideCanonicalMatch(baseRoute(), [candidate]).kind).toBe("merge");
    expect(decideCanonicalMatch(baseRoute({ name: "West Highland", lat: null, lng: null, area: { name: "Scotland", region: null, country: "United Kingdom" } }), [candidate]).kind).toBe("suggest");
    expect(decideCanonicalMatch(baseRoute({ name: "West Highland Way", lat: 40, lng: -3, area: { name: "Madrid", region: "Madrid", country: "Spain" } }), [candidate]).kind).toBe("none");
  });

  it("does not overwrite user-edited fields and respects source precedence", () => {
    expect(shouldApplyImportedField({ name: { precedence: 1000, userEdited: true } }, "name", 400)).toBe(false);
    expect(shouldApplyImportedField({ name: { precedence: 300 } }, "name", 400)).toBe(true);
    expect(shouldApplyImportedField({ name: { precedence: 400 } }, "name", 300)).toBe(false);
  });

  it("estimates hiking time and smooths batch DEM noise", async () => {
    expect(estimateHikingDurationMinutes(10_000, 600)).toBe(180);
    const ascent = await calculateDemAscent({ type: "LineString", coordinates: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] }, { sample: async () => [100, 104, 150, 108, 115] });
    expect(ascent).toBeLessThan(30);
  });
});
