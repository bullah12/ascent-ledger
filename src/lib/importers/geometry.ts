import type { Geometry, LineString, Position } from "geojson";
import { simplifyTrack } from "@/lib/tracks";
import type { GeometryCompletenessValue, RouteSegment } from "./types";

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function geometryLineParts(geometry: Geometry | null | undefined): Position[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(geometryLineParts);
  }
  return [];
}

/** Joins only parts whose endpoints actually meet. Disconnected fragments are
 * never bridged with invented linework; the longest connected chain wins. */
export function longestConnectedLine(parts: Position[][]): LineString | null {
  return connectedLines(parts).sort((a, b) => b.coordinates.length - a.coordinates.length)[0] ?? null;
}

/** Connect every endpoint-compatible chain without inventing bridges. */
export function connectedLines(parts: Position[][]): LineString[] {
  const remaining = parts
    .filter((part) => part.length >= 2)
    .map((part) => part.map((position) => [position[0], position[1]] as Position));
  const chains: Position[][] = [];

  while (remaining.length > 0) {
    const chain = remaining.shift()!;
    let extended = true;
    while (extended) {
      extended = false;
      for (let index = 0; index < remaining.length; index++) {
        const part = remaining[index];
        const first = chain[0];
        const last = chain.at(-1)!;
        const partFirst = part[0];
        const partLast = part.at(-1)!;
        if (samePoint(last, partFirst)) chain.push(...part.slice(1));
        else if (samePoint(last, partLast)) chain.push(...part.slice(0, -1).reverse());
        else if (samePoint(first, partLast)) chain.unshift(...part.slice(0, -1));
        else if (samePoint(first, partFirst)) chain.unshift(...part.slice(1).reverse());
        else continue;
        remaining.splice(index, 1);
        extended = true;
        break;
      }
    }
    chains.push(chain);
  }

  return chains.flatMap((chain) => {
    try { return [simplifyTrack(chain)]; } catch { return []; }
  });
}

export function geometryToLineString(geometry: Geometry | null | undefined): LineString | null {
  return longestConnectedLine(geometryLineParts(geometry));
}

const EARTH_RADIUS_M = 6_371_008.8;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

export function geodesicLengthM(line: LineString | null | undefined): number | null {
  if (!line || line.coordinates.length < 2) return null;
  let total = 0;
  for (let index = 1; index < line.coordinates.length; index++) {
    const [lng1, lat1] = line.coordinates[index - 1];
    const [lng2, lat2] = line.coordinates[index];
    const dLat = radians(lat2 - lat1);
    const dLng = radians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
    total += 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return Math.round(total);
}

export type OrderedMemberGeometry = {
  type: "way" | "relation";
  ref: number;
  role: string;
  coordinates: Position[] | null;
  clipped?: boolean;
};

export type AssembledRouteGeometry = {
  canonical: LineString | null;
  segments: RouteSegment[];
  completeness: GeometryCompletenessValue;
};

/**
 * Assemble relation members in relation order. Empty/main/forward/backward
 * members form the canonical route. Alternatives and excursions remain as
 * structured segments; disconnected canonical chains are preserved rather than
 * silently discarded. `canonical` is the first main chain for legacy map UI.
 */
export function assembleOrderedRelationGeometry(
  members: OrderedMemberGeometry[]
): AssembledRouteGeometry {
  const isMain = (role: string) => !role || ["main", "forward", "backward"].includes(role);
  const segments: RouteSegment[] = members.map((member) => ({
    role: member.role,
    memberType: member.type,
    memberId: String(member.ref),
    geometry: member.coordinates && member.coordinates.length >= 2
      ? { type: "LineString", coordinates: member.coordinates }
      : null,
    complete: Boolean(member.coordinates?.length && !member.clipped),
  }));

  const mainParts = members.filter((member) => isMain(member.role));
  const chains: Position[][] = [];
  for (const member of mainParts) {
    if (!member.coordinates || member.coordinates.length < 2) continue;
    const coords = member.role === "backward"
      ? [...member.coordinates].reverse()
      : member.coordinates.map((position) => [position[0], position[1]] as Position);
    const current = chains.at(-1);
    if (!current) {
      chains.push(coords);
      continue;
    }
    const currentEnd = current.at(-1)!;
    if (samePoint(currentEnd, coords[0])) current.push(...coords.slice(1));
    else if (samePoint(currentEnd, coords.at(-1)!)) current.push(...coords.slice(0, -1).reverse());
    else chains.push(coords);
  }

  const canonicalCoordinates = chains[0] ?? null;
  const missingMain = mainParts.some((member) => !member.coordinates);
  const clipped = members.some((member) => member.clipped);
  const completeness: GeometryCompletenessValue = clipped
    ? "clipped"
    : missingMain || chains.length > 1
      ? "incomplete"
      : canonicalCoordinates
        ? "complete"
        : "unknown";

  return {
    canonical: canonicalCoordinates
      ? { type: "LineString", coordinates: canonicalCoordinates }
      : null,
    segments,
    completeness,
  };
}
