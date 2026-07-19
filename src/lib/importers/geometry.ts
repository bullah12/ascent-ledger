import type { Geometry, LineString, Position } from "geojson";
import { simplifyTrack } from "@/lib/tracks";

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

  const longest = chains.sort((a, b) => b.length - a.length)[0];
  if (!longest) return null;
  try {
    return simplifyTrack(longest);
  } catch {
    return null;
  }
}

export function geometryToLineString(geometry: Geometry | null | undefined): LineString | null {
  return longestConnectedLine(geometryLineParts(geometry));
}
