import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import type { Position } from "geojson";
import { assembleOrderedRelationGeometry, connectedLines, geodesicLengthM, type OrderedMemberGeometry } from "./geometry";
import { geofabrikShard, GEOFABRIK_EUROPE_SHARDS } from "./geofabrik-registry";
import { hardestSacScale } from "./osm-sac";
import { readOsmPbf, type OsmPbfRelation, type OsmPbfWay } from "./osm-pbf-reader";
import type { ExternalRoute, ImporterCompletion, ImporterOptions, RouteImporter } from "./types";

const BASE_URL = "https://download.geofabrik.de";
const USER_AGENT = "Ascent-Ledger route ingestion/1.0 (contact: repository maintainers)";
const REQUEST_TIMEOUT_MS = 120_000;
const RETRIES = 3;
const RELEVANT_TAGS = [
  "name", "ref", "network", "operator", "website", "wikidata", "description",
  "distance", "ascent", "descent", "roundtrip", "osmc:symbol", "sac_scale",
  "trail_visibility", "surface", "state", "route", "type", "access", "highway",
  "via_ferrata_scale", "climbing",
] as const;

type FetchLike = typeof fetch;
type Candidate = { type: "relation"; entity: OsmPbfRelation } | { type: "way"; entity: OsmPbfWay };

function keepTags(tags: Record<string, string>) {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (RELEVANT_TAGS.includes(key as (typeof RELEVANT_TAGS)[number]) || key.startsWith("name:")) kept[key] = value;
  }
  return kept;
}

function isUsable(tags: Record<string, string>, allowRestricted = false) {
  const status = `${tags.state ?? ""} ${tags.status ?? ""}`.toLowerCase();
  if (/proposed|abandoned|disused|razed/.test(status)) return false;
  if (!allowRestricted && /^(private|no)$/.test(tags.access ?? "")) return false;
  return Boolean(tags.name?.trim() || tags.ref?.trim());
}

function isHikingRelation(relation: OsmPbfRelation) {
  return relation.tags.type === "route" && /^(hiking|foot)$/.test(relation.tags.route ?? "");
}

function isCountryBoundary(relation: OsmPbfRelation) {
  return relation.tags.boundary === "administrative" && relation.tags.admin_level === "2";
}

function pointInRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isDirectWay(way: OsmPbfWay) {
  return way.tags.highway === "via_ferrata" || Boolean(way.tags.via_ferrata_scale) ||
    /^(route|route_bottom)$/.test(way.tags.climbing ?? "");
}

function localizedNames(tags: Record<string, string>) {
  return Object.fromEntries(Object.entries(tags).filter(([key]) => key.startsWith("name:")).map(([key, value]) => [key.slice(5), value]));
}

function positiveNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/\s*(km|m)\s*$/i, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return /km\s*$/i.test(value) ? Math.round(parsed * 1_000) : Math.round(parsed);
}

function shape(tags: Record<string, string>): ExternalRoute["routeShape"] {
  if (tags.roundtrip === "yes") return "loop";
  if (tags.roundtrip === "no") return "point_to_point";
  return "unknown";
}

async function retryFetch(fetchImpl: FetchLike, url: string, init: RequestInit, log?: (message: string) => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok || response.status === 304) return response;
      if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`);
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const delay = 1_000 * 2 ** attempt;
    log?.(`geofabrik: retrying ${basename(url)} in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadExtract({
  shardKey, fetchImpl, cacheDir, maxBytes, log,
}: {
  shardKey: string;
  fetchImpl: FetchLike;
  cacheDir: string;
  maxBytes: number;
  log?: (message: string) => void;
}) {
  const shard = geofabrikShard(shardKey);
  await mkdir(cacheDir, { recursive: true });
  const target = join(cacheDir, `${shardKey}-latest.osm.pbf`);
  const etagPath = `${target}.etag`;
  let etag: string | null = null;
  try { etag = (await readFile(etagPath, "utf8")).trim() || null; } catch { /* first download */ }
  const url = `${BASE_URL}/${shard.path}-latest.osm.pbf`;
  const response = await retryFetch(fetchImpl, url, {
    headers: { "user-agent": USER_AGENT, ...(etag ? { "if-none-match": etag } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, log);
  if (response.status === 304) return { file: target, etag, checksum: null as string | null };
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new Error(`Geofabrik shard ${shardKey} is ${announced} bytes; limit is ${maxBytes}`);
  }
  if (!response.body) throw new Error(`Geofabrik response for ${shardKey} has no body`);
  const partial = `${target}.part`;
  const hash = createHash("md5");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error(`Geofabrik shard exceeded ${maxBytes} byte limit`));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  let checksum: string;
  try {
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(partial));
    checksum = hash.digest("hex");
    try {
      const checksumResponse = await fetchImpl(`${url}.md5`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (checksumResponse.ok) {
        const expected = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase();
        if (expected && /^[a-f0-9]{32}$/.test(expected) && expected !== checksum) {
          throw new Error(`Geofabrik MD5 mismatch for ${shardKey}`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("MD5 mismatch")) throw error;
      log?.(`geofabrik: checksum sidecar unavailable for ${shardKey}; retained local MD5`);
    }
    await rename(partial, target);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  etag = response.headers.get("etag");
  if (etag) await writeFile(etagPath, etag);
  return { file: target, etag, checksum };
}

async function fingerprint(file: string) {
  const details = await stat(file);
  return `${details.size}:${Math.floor(details.mtimeMs)}`;
}

export async function extractOsmRoutesFromPbf({
  file, shardKey, maxRoutes, cursor = null, snapshotId,
}: {
  file: string;
  shardKey: string;
  maxRoutes: number;
  cursor?: string | null;
  snapshotId?: string | null;
}): Promise<{ routes: ExternalRoute[]; completion: ImporterCompletion }> {
  const shard = geofabrikShard(shardKey);
  const allRouteRelations = new Map<number, OsmPbfRelation>();
  const countryBoundaries = new Map<number, OsmPbfRelation>();
  const candidates: Candidate[] = [];
  const candidateWays = new Map<number, OsmPbfWay>();

  for await (const entity of readOsmPbf(file)) {
    if (entity.type === "way" && isDirectWay(entity) && isUsable(entity.tags)) {
      candidates.push({ type: "way", entity });
      candidateWays.set(entity.id, entity);
    } else if (entity.type === "relation") {
      if (isHikingRelation(entity)) {
        allRouteRelations.set(entity.id, entity);
        if (isUsable(entity.tags)) candidates.push({ type: "relation", entity });
      }
      if (isCountryBoundary(entity)) countryBoundaries.set(entity.id, entity);
    }
  }

  const neededWayIds = new Set<number>(candidateWays.keys());
  const visitRelation = (relation: OsmPbfRelation, visited = new Set<number>()) => {
    if (visited.has(relation.id)) return;
    visited.add(relation.id);
    for (const member of relation.members) {
      if (member.type === "way") neededWayIds.add(member.ref);
      if (member.type === "relation") {
        const child = allRouteRelations.get(member.ref);
        if (child) visitRelation(child, visited);
      }
    }
  };
  for (const relation of allRouteRelations.values()) visitRelation(relation);
  for (const relation of countryBoundaries.values()) {
    for (const member of relation.members) if (member.type === "way" && member.role !== "subarea") neededWayIds.add(member.ref);
  }

  const ways = new Map<number, OsmPbfWay>(candidateWays);
  const nodeIds = new Set<number>();
  for await (const entity of readOsmPbf(file)) {
    if (entity.type !== "way" || !neededWayIds.has(entity.id)) continue;
    ways.set(entity.id, entity);
    for (const ref of entity.refs) nodeIds.add(ref);
  }
  const nodes = new Map<number, Position>();
  for await (const entity of readOsmPbf(file)) {
    if (entity.type === "node" && nodeIds.has(entity.id)) nodes.set(entity.id, [entity.lon, entity.lat]);
  }

  const wayCoordinates = (id: number) => {
    const way = ways.get(id);
    if (!way) return null;
    const coordinates = way.refs.flatMap((ref) => {
      const point = nodes.get(ref);
      return point ? [point] : [];
    });
    return coordinates.length >= 2 ? coordinates : null;
  };
  const relationGeometry: (
    relation: OsmPbfRelation,
    seen?: Set<number>
  ) => ReturnType<typeof assembleOrderedRelationGeometry> = (relation, seen = new Set<number>()) => {
    if (seen.has(relation.id)) return assembleOrderedRelationGeometry([]);
    seen.add(relation.id);
    const resolved: OrderedMemberGeometry[] = [];
    for (const member of relation.members) {
      if (member.type === "way") {
        const way = ways.get(member.ref);
        const coordinates = wayCoordinates(member.ref);
        resolved.push({ type: "way", ref: member.ref, role: member.role, coordinates, clipped: Boolean(way && coordinates && coordinates.length < way.refs.length) });
      }
      if (member.type === "relation") {
        const child = allRouteRelations.get(member.ref);
        const childGeometry = child ? relationGeometry(child, new Set(seen)) : null;
        resolved.push({ type: "relation", ref: member.ref, role: member.role, coordinates: childGeometry?.canonical?.coordinates ?? null, clipped: childGeometry?.completeness === "clipped" });
      }
    }
    return assembleOrderedRelationGeometry(resolved);
  };
  const administrativeRings = [...countryBoundaries.values()].flatMap((relation) => {
    const lines = connectedLines(relation.members.flatMap((member) => {
      if (member.type !== "way" || member.role === "inner") return [];
      const coordinates = wayCoordinates(member.ref);
      return coordinates ? [coordinates] : [];
    }));
    return lines.filter((line) => line.coordinates.length >= 4).map((line) => ({ country: relation.tags["name:en"] ?? relation.tags.name, ring: line.coordinates }));
  });
  const spatialCountry = (line: ExternalRoute["pathGeojson"]) => {
    const point = line?.coordinates[0];
    if (!point) return null;
    return administrativeRings.find((boundary) => boundary.country && pointInRing(point, boundary.ring))?.country ?? null;
  };

  const start = Math.max(0, Number(cursor ?? 0) || 0);
  const selected = candidates.slice(start, start + maxRoutes);
  const routes: ExternalRoute[] = selected.flatMap((candidate, selectedIndex) => {
    const tags = candidate.entity.tags;
    const name = tags.name?.trim() || tags.ref?.trim();
    if (!name) return [];
    const externalId = `${candidate.type}/${candidate.entity.id}`;
    let pathGeojson;
    let geometrySegments;
    let geometryCompleteness: ExternalRoute["geometryCompleteness"];
    let memberWays: OsmPbfWay[] = [];
    if (candidate.type === "relation") {
      const assembled = relationGeometry(candidate.entity);
      pathGeojson = assembled.canonical;
      geometrySegments = assembled.segments;
      geometryCompleteness = assembled.completeness;
      memberWays = candidate.entity.members.flatMap((member) => member.type === "way" && ways.get(member.ref) ? [ways.get(member.ref)!] : []);
    } else {
      const coordinates = wayCoordinates(candidate.entity.id);
      pathGeojson = coordinates ? { type: "LineString" as const, coordinates } : null;
      geometrySegments = [{ role: "", memberType: "way" as const, memberId: String(candidate.entity.id), geometry: pathGeojson, complete: Boolean(pathGeojson && pathGeojson.coordinates.length === candidate.entity.refs.length) }];
      geometryCompleteness = pathGeojson && pathGeojson.coordinates.length === candidate.entity.refs.length ? "complete" : "clipped";
      memberWays = [candidate.entity];
    }
    if (!pathGeojson) return [];
    const sac = hardestSacScale([tags.sac_scale, ...memberWays.map((way) => way.tags.sac_scale)]);
    const viaFerrata = candidate.type === "way" && (tags.highway === "via_ferrata" || Boolean(tags.via_ferrata_scale));
    const climbing = candidate.type === "way" && /^(route|route_bottom)$/.test(tags.climbing ?? "");
    const discipline = viaFerrata ? Discipline.via_ferrata : climbing ? Discipline.rock : Discipline.hiking;
    const gradeRaw = viaFerrata ? tags.via_ferrata_scale ?? null : discipline === Discipline.hiking ? sac.gradeRaw : null;
    const gradeSystem = viaFerrata && gradeRaw ? GradeSystem.via_ferrata_scale : discipline === Discipline.hiking && gradeRaw ? GradeSystem.sac_hiking : null;
    const sourceDistance = positiveNumber(tags.distance);
    const joinedCountry = spatialCountry(pathGeojson) ?? shard.country;
    const joinedRegion = shard.key === "ireland-ni"
      ? joinedCountry === "United Kingdom" ? "Northern Ireland" : joinedCountry === "Ireland" ? null : shard.region ?? null
      : shard.region ?? null;
    return [{
      externalId,
      externalUrl: `https://www.openstreetmap.org/${externalId}`,
      name,
      localizedNames: localizedNames(tags),
      discipline,
      gradeSystem,
      gradeRaw,
      difficultyDerivation: discipline === Discipline.hiking && sac.rawValues.length ? { derived: true, method: "hardest relevant OSM member-way sac_scale", rawValues: sac.rawValues } : null,
      lat: null,
      lng: null,
      lengthM: sourceDistance,
      calculatedLengthM: sourceDistance ? null : geodesicLengthM(pathGeojson),
      ascentM: positiveNumber(tags.ascent),
      descentM: positiveNumber(tags.descent),
      pitches: null,
      description: tags.description?.trim() || null,
      pathGeojson,
      geometrySegments,
      geometryCompleteness,
      routeShape: shape(tags),
      routeStatus: tags.state ?? null,
      qualityRating: null,
      officialRef: tags.ref ?? null,
      network: tags.network ?? null,
      operator: tags.operator ?? null,
      wikidata: tags.wikidata ?? null,
      website: tags.website ?? null,
      licence: "ODbL 1.0",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: "© OpenStreetMap contributors",
      rawMetadata: { tags: keepTags(tags), members: candidate.type === "relation" ? candidate.entity.members : undefined, shard: shardKey },
      importCursor: String(start + selectedIndex + 1),
      area: { name: joinedRegion ?? joinedCountry, region: joinedRegion, country: joinedCountry },
    } satisfies ExternalRoute];
  });
  const nextOffset = start + selected.length;
  const complete = nextOffset >= candidates.length;
  return {
    routes,
    completion: {
      nextCursor: complete ? null : String(nextOffset),
      snapshotId: snapshotId ?? await fingerprint(file),
      snapshotComplete: complete,
      state: { candidates: candidates.length },
    },
  };
}

export function createOsmGeofabrikImporter({ fetchImpl = fetch }: { fetchImpl?: FetchLike } = {}): RouteImporter {
  return {
    source: "osm_geofabrik",
    precedence: 300,
    defaultLicence: "ODbL 1.0",
    defaultLicenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    defaultAttribution: "© OpenStreetMap contributors",
    shards: GEOFABRIK_EUROPE_SHARDS.map((shard) => shard.key),
    activities: ["all", "hiking", "via_ferrata", "rock"],
    async *fetchRoutes(options: ImporterOptions) {
      const shardKey = options.shard ?? "uk-england";
      const localFile = options.localFile ?? process.env.OSM_PBF_LOCAL_FILE;
      let file: string;
      let etag: string | null = null;
      let checksum: string | null = null;
      if (localFile) {
        file = localFile;
      } else {
        const cacheDir = process.env.OSM_PBF_CACHE_DIR || join(tmpdir(), "ascent-ledger-osm");
        const maxMb = Number(process.env.GEOFABRIK_MAX_DOWNLOAD_MB ?? 4096);
        const downloaded = await downloadExtract({ shardKey, fetchImpl, cacheDir, maxBytes: Math.max(1, maxMb) * 1024 * 1024, log: options.log });
        ({ file, etag, checksum } = downloaded);
      }
      const extracted = await extractOsmRoutesFromPbf({
        file, shardKey, maxRoutes: options.maxRoutes, cursor: options.cursor, snapshotId: options.snapshotId,
      });
      for (const route of extracted.routes) {
        if (options.activity && options.activity !== "all" && route.discipline !== options.activity) continue;
        yield route;
      }
      return { ...extracted.completion, etag, checksum };
    },
  };
}

export const osmGeofabrikImporter = createOsmGeofabrikImporter();
