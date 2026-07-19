import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import type { Position } from "geojson";
import { longestConnectedLine } from "./geometry";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_DELAY_MS = 1_500;

// Bounded chunks covering the United Kingdom and the Alpine Convention
// perimeter. They deliberately do not enable arbitrary worldwide queries.
export const APPROVED_OVERPASS_BBOXES = [
  { key: "uk-south", bbox: "49.8,-8.7,54.8,2.0" },
  { key: "uk-north", bbox: "54.8,-8.7,60.9,2.0" },
  { key: "alps-west", bbox: "43.4,4.0,48.5,9.0" },
  { key: "alps-east", bbox: "43.4,9.0,48.5,17.5" },
] as const;

type OsmTags = Record<string, string>;
type OsmMember = { type: string; ref: number; geometry?: { lon: number; lat: number }[] };
type OsmElement = {
  type: "relation" | "way";
  id: number;
  tags?: OsmTags;
  geometry?: { lon: number; lat: number }[];
  members?: OsmMember[];
};
type OsmPayload = { elements?: OsmElement[] };

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

function osmQuery(bbox: string): string {
  return `[out:json][timeout:25];(
    relation["type"="route"]["route"~"^(hiking|foot)$"](${bbox});
    way["highway"="via_ferrata"](${bbox});
    way["via_ferrata_scale"](${bbox});
  );out tags geom;`;
}

function sacGrade(tags: OsmTags): string | null {
  const value = tags.sac_scale?.trim().toUpperCase();
  const match = value?.match(/^T([1-6])(?:\b|$)/);
  return match ? `T${match[1]}` : null;
}

function elementParts(element: OsmElement): Position[][] {
  if (element.geometry?.length) {
    return [element.geometry.map(({ lon, lat }) => [lon, lat])];
  }
  return (element.members ?? []).flatMap((member) =>
    member.geometry?.length
      ? [member.geometry.map(({ lon, lat }) => [lon, lat] as Position)]
      : []
  );
}

export function parseOverpassElement(element: OsmElement): ExternalRoute | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim() || tags.ref?.trim();
  if (!name) return null;
  const pathGeojson = longestConnectedLine(elementParts(element));
  if (!pathGeojson) return null;
  const gradeRaw = sacGrade(tags);
  const country = tags["addr:country"] || null;

  return {
    externalId: `${element.type}/${element.id}`,
    externalUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    name,
    discipline: Discipline.hiking,
    gradeSystem: gradeRaw ? GradeSystem.sac_hiking : null,
    gradeRaw,
    lat: null,
    lng: null,
    lengthM: null,
    pitches: null,
    description: tags.description?.trim() || null,
    pathGeojson,
    qualityRating: null,
    area: tags.operator
      ? { name: tags.operator, region: null, country }
      : null,
  };
}

export function createOsmOverpassImporter({
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  scopes = APPROVED_OVERPASS_BBOXES,
}: {
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  scopes?: ReadonlyArray<{ key: string; bbox: string }>;
} = {}): RouteImporter {
  return {
    source: "osm_overpass",
    async *fetchRoutes({ maxRoutes, log }: ImporterOptions) {
      let yielded = 0;
      const seen = new Set<string>();
      for (const scope of scopes) {
        if (yielded >= maxRoutes) return;
        const body = new URLSearchParams({ data: osmQuery(scope.bbox) });
        const response = await fetchImpl(OVERPASS_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "user-agent": "Ascent-Ledger route sync (contact: repository maintainers)",
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Overpass HTTP ${response.status} for ${scope.key}`);
        const payload = (await response.json()) as OsmPayload;
        let scopeCount = 0;
        for (const element of payload.elements ?? []) {
          if (yielded >= maxRoutes) return;
          const route = parseOverpassElement(element);
          if (!route || seen.has(route.externalId)) continue;
          seen.add(route.externalId);
          yielded++;
          scopeCount++;
          yield route;
        }
        log?.(`osm_overpass: ${scope.key} — ${scopeCount} routes`);
        await sleep(REQUEST_DELAY_MS);
      }
    },
  };
}

export const osmOverpassImporter = createOsmOverpassImporter();
