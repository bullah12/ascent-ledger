import { Discipline } from "@/generated/prisma/enums";
import type { LineString } from "geojson";
import { geodesicLengthM } from "./geometry";
import type { ExternalRoute, RouteImporter } from "./types";

type JsonLdValue = string | { "@value"?: string; "@language"?: string; "@id"?: string };
export type DatatourismeTour = Record<string, unknown> & {
  "@id"?: string;
  "@type"?: string | string[];
  "rdfs:label"?: JsonLdValue | JsonLdValue[];
  hasBeenCreatedBy?: JsonLdValue | JsonLdValue[];
  lastUpdate?: string;
  geojson?: LineString;
};

function values(value: JsonLdValue | JsonLdValue[] | undefined) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: JsonLdValue | JsonLdValue[] | undefined, language = "en") {
  const items = values(value);
  const preferred = items.find((item) => typeof item === "object" && item["@language"] === language) ?? items[0];
  return typeof preferred === "string" ? preferred : preferred?.["@value"] ?? preferred?.["@id"] ?? null;
}

function activity(types: string[]) {
  const joined = types.join(" ").toLowerCase();
  if (/cycl|velo|bike/.test(joined) && !/walk|hik|pedestrian|mountain|ferrata/.test(joined)) return null;
  if (/ferrata/.test(joined)) return Discipline.via_ferrata;
  if (/mountaineer|alpinism/.test(joined)) return Discipline.alpine;
  if (/climb|escalade/.test(joined)) return Discipline.rock;
  if (/walk|hik|pedestrian|rambling|tour/.test(joined)) return Discipline.hiking;
  return null;
}

export function parseDatatourismeTour(tour: DatatourismeTour): ExternalRoute | null {
  const id = tour["@id"]?.trim();
  const name = text(tour["rdfs:label"]);
  const types = Array.isArray(tour["@type"]) ? tour["@type"] : tour["@type"] ? [tour["@type"]] : [];
  const discipline = activity(types);
  const geometry = tour.geojson;
  if (!id || !name || !discipline || geometry?.type !== "LineString" || geometry.coordinates.length < 2) return null;
  const updated = tour.lastUpdate ? new Date(tour.lastUpdate) : null;
  const producer = text(tour.hasBeenCreatedBy, "fr") ?? "DATAtourisme producer";
  return {
    externalId: id,
    externalUrl: id.startsWith("http") ? id : "https://www.datatourisme.fr/",
    name,
    localizedNames: Object.fromEntries(values(tour["rdfs:label"]).flatMap((item) => typeof item === "object" && item["@language"] && item["@value"] ? [[item["@language"], item["@value"]]] : [])),
    discipline,
    gradeSystem: null,
    gradeRaw: null,
    lat: null,
    lng: null,
    lengthM: null,
    calculatedLengthM: geodesicLengthM(geometry),
    pitches: null,
    description: text(tour["rdfs:comment"] as JsonLdValue | JsonLdValue[] | undefined),
    pathGeojson: geometry,
    geometryCompleteness: "complete",
    geometrySegments: [{ role: "main", geometry, complete: true }],
    qualityRating: null,
    operator: producer,
    sourceUpdatedAt: updated && !Number.isNaN(updated.valueOf()) ? updated : null,
    licence: "Etalab Open Licence 2.0",
    licenceUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    attribution: `${producer} via DATAtourisme; last update ${tour.lastUpdate ?? "not supplied"}`,
    rawMetadata: tour,
    area: { name: "DATAtourisme itineraries", region: null, country: "France" },
  };
}

export const datatourismeImporter: RouteImporter = {
  source: "france_datatourisme",
  precedence: 400,
  defaultLicence: "Etalab Open Licence 2.0",
  defaultLicenceUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  defaultAttribution: "Individual producer via DATAtourisme; last-update date required",
  async *fetchRoutes({ maxRoutes, cursor, snapshotId }) {
    const endpoint = process.env.DATATOURISME_TOUR_URL;
    if (!endpoint) throw new Error("DATATOURISME_TOUR_URL is not configured; provide the official /tour query or daily TOUR export URL");
    const response = await fetch(endpoint, { headers: { "user-agent": "Ascent-Ledger route sync (contact: repository maintainers)" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`DATAtourisme HTTP ${response.status}`);
    const payload = await response.json() as DatatourismeTour[] | { "@graph"?: DatatourismeTour[] };
    const records = Array.isArray(payload) ? payload : payload["@graph"] ?? [];
    const offset = Math.max(0, Number(cursor ?? 0) || 0);
    const selected = records.slice(offset, offset + maxRoutes);
    for (let index = 0; index < selected.length; index++) {
      const route = parseDatatourismeTour(selected[index]);
      if (route) yield { ...route, importCursor: String(offset + index + 1) };
    }
    const nextOffset = offset + selected.length;
    const complete = nextOffset >= records.length;
    return { nextCursor: complete ? null : String(nextOffset), snapshotId: snapshotId ?? response.headers.get("etag") ?? new Date().toISOString().slice(0, 10), snapshotComplete: complete, etag: response.headers.get("etag") };
  },
};
