import { gpx, kml } from "@tmcw/togeojson";
import { lineString } from "@turf/helpers";
import simplify from "@turf/simplify";
import { DOMParser } from "@xmldom/xmldom";
import type { Geometry, LineString, Position } from "geojson";

export type TrackFormat = "gpx" | "kml";
export type TrackPathSource = "drawn" | "gpx_upload" | "kml_upload" | "import";

export const TARGET_TRACK_POINTS = 800;
export const MAX_STORED_TRACK_POINTS = 1_000;
export const MAX_INPUT_TRACK_POINTS = 100_000;

const COORDINATE_PRECISION = 6;

export class TrackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackError";
  }
}

export function trackFormatFromFilename(filename: string): TrackFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".kml")) return "kml";
  return null;
}

export function pathSourceForFormat(format: TrackFormat): TrackPathSource {
  return format === "gpx" ? "gpx_upload" : "kml_upload";
}

function round(value: number): number {
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function normalisePosition(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TrackError("Every track point must contain longitude and latitude");
  }
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new TrackError("Track coordinates must be finite numbers");
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new TrackError("Track coordinates must use WGS84 longitude/latitude");
  }
  return [round(lng), round(lat)];
}

function samePosition(a: Position | undefined, b: Position): boolean {
  return Boolean(a && a[0] === b[0] && a[1] === b[1]);
}

function normalisePositions(values: unknown[], maxPoints = MAX_INPUT_TRACK_POINTS): Position[] {
  if (values.length > maxPoints) {
    throw new TrackError(`Track contains more than ${maxPoints.toLocaleString()} points`);
  }
  const positions: Position[] = [];
  for (const value of values) {
    const position = normalisePosition(value);
    if (!samePosition(positions.at(-1), position)) positions.push(position);
  }
  if (positions.length < 2) {
    throw new TrackError("A track needs at least two distinct points");
  }
  return positions;
}

function collectLineParts(geometry: Geometry | null, parts: Position[][]): void {
  if (!geometry) return;
  if (geometry.type === "LineString") {
    parts.push(geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiLineString") {
    parts.push(...geometry.coordinates);
    return;
  }
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) collectLineParts(child, parts);
  }
}

function joinLineParts(parts: Position[][]): Position[] {
  const joined: Position[] = [];
  for (const part of parts) {
    for (const position of part) {
      if (!samePosition(joined.at(-1), position)) joined.push(position);
    }
  }
  return joined;
}

function sampleToBudget(coordinates: Position[], budget: number): Position[] {
  if (coordinates.length <= budget) return coordinates;
  const sampled: Position[] = [];
  for (let index = 0; index < budget; index++) {
    const sourceIndex = Math.round((index * (coordinates.length - 1)) / (budget - 1));
    sampled.push(coordinates[sourceIndex]);
  }
  return sampled;
}

/** Douglas–Peucker simplification, with a deterministic sampling guard for
 * unusually noisy tracks that do not converge below the storage budget. */
export function simplifyTrack(
  coordinates: Position[],
  targetPoints = TARGET_TRACK_POINTS
): LineString {
  const normalised = normalisePositions(coordinates);
  if (normalised.length <= MAX_STORED_TRACK_POINTS) {
    return { type: "LineString", coordinates: normalised };
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of normalised) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  const span = Math.max(maxLng - minLng, maxLat - minLat, 0.000001);

  let low = 0;
  let high = span;
  let best: Position[] | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const tolerance = (low + high) / 2;
    const candidate = simplify(lineString(normalised), {
      tolerance,
      highQuality: true,
      mutate: false,
    }).geometry.coordinates;
    if (candidate.length > targetPoints) {
      low = tolerance;
    } else {
      best = candidate;
      high = tolerance;
    }
  }

  const withinBudget = sampleToBudget(best ?? normalised, MAX_STORED_TRACK_POINTS);
  return {
    type: "LineString",
    coordinates: normalisePositions(withinBudget, MAX_STORED_TRACK_POINTS),
  };
}

export function validateLineString(value: unknown): LineString {
  if (!value || typeof value !== "object") {
    throw new TrackError("Track geometry must be a GeoJSON LineString");
  }
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "LineString" || !Array.isArray(candidate.coordinates)) {
    throw new TrackError("Track geometry must be a GeoJSON LineString");
  }
  return simplifyTrack(candidate.coordinates as Position[]);
}

export function lineStringOrNull(value: unknown): LineString | null {
  try {
    return value === null || value === undefined ? null : validateLineString(value);
  } catch {
    return null;
  }
}

export function parseSubmittedTrack(value: FormDataEntryValue | null): LineString | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return validateLineString(JSON.parse(value));
  } catch (error) {
    if (error instanceof TrackError) throw error;
    throw new TrackError("Track geometry is not valid JSON");
  }
}

export function parseTrackText(text: string, format: TrackFormat): LineString {
  if (!text.trim()) throw new TrackError("Track file is empty");

  let document: ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>;
  try {
    document = new DOMParser({
      onError(level, message) {
        if (level !== "warning") throw new TrackError(`Invalid XML: ${message}`);
      },
    }).parseFromString(text, "application/xml");
  } catch (error) {
    if (error instanceof TrackError) throw error;
    throw new TrackError("Track file contains invalid XML");
  }

  let collection;
  try {
    collection = format === "gpx" ? gpx(document) : kml(document, { skipNullGeometry: true });
  } catch {
    throw new TrackError(`Could not parse the ${format.toUpperCase()} track`);
  }

  const parts: Position[][] = [];
  for (const feature of collection.features) collectLineParts(feature.geometry, parts);
  if (parts.length === 0) {
    throw new TrackError(`${format.toUpperCase()} file does not contain a route or track line`);
  }
  return simplifyTrack(joinLineParts(parts));
}

export async function parseTrackFile(file: File): Promise<{
  format: TrackFormat;
  geometry: LineString;
}> {
  const format = trackFormatFromFilename(file.name);
  if (!format) throw new TrackError("Track file must be GPX or KML");
  return { format, geometry: parseTrackText(await file.text(), format) };
}

export function lineStartPoint(line: LineString): { lng: number; lat: number } {
  const [lng, lat] = line.coordinates[0];
  return { lng, lat };
}

export function lineBounds(line: LineString): [[number, number], [number, number]] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of line.coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}
