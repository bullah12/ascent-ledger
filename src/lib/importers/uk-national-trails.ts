import { Discipline } from "@/generated/prisma/enums";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { geometryToLineString } from "./geometry";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

const TIMEOUT_MS = 30_000;
const ENGLAND_ENDPOINT =
  "https://services.arcgis.com/JJzESW51TqeY9uat/ArcGIS/rest/services/National_Trails_England/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson";
const WALES_ENDPOINT =
  "https://datamap.gov.wales/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=inspire-nrw%3ANRW_NATIONAL_TRAIL&outputFormat=application%2Fjson&srsName=EPSG%3A4326";

type FetchLike = typeof fetch;

function stringProperty(properties: GeoJsonProperties, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

export function parseNationalTrailFeature(
  feature: Feature<Geometry, GeoJsonProperties>,
  country: "England" | "Wales"
): ExternalRoute | null {
  const name = stringProperty(feature.properties, ["Name", "name", "TITLE", "title"]);
  const id =
    feature.id !== undefined
      ? String(feature.id)
      : stringProperty(feature.properties, ["GlobalID", "globalid", "id", "OBJECTID_1", "OBJECTID"]);
  const pathGeojson = geometryToLineString(feature.geometry);
  if (!name || !id || !pathGeojson) return null;
  const isEngland = country === "England";

  return {
    externalId: id,
    externalUrl: isEngland
      ? "https://www.data.gov.uk/dataset/ac8c851c-99a0-4488-8973-6c8863529c45/national-trails-england3"
      : "https://datamap.gov.wales/layers/inspire-nrw:NRW_NATIONAL_TRAIL/metadata_detail",
    name,
    discipline: Discipline.hiking,
    gradeSystem: null,
    gradeRaw: null,
    lat: null,
    lng: null,
    lengthM: (() => {
      const value = Number(feature.properties?.Length_Km);
      return Number.isFinite(value) && value > 0 ? Math.round(value * 1_000) : null;
    })(),
    pitches: null,
    description: null,
    pathGeojson,
    qualityRating: null,
    area: { name: `National Trails — ${country}`, region: country, country: "United Kingdom" },
  };
}

export function createNationalTrailsImporter({
  source,
  country,
  endpoint,
  fetchImpl = fetch,
}: {
  source: "national_trails_england" | "national_trails_wales";
  country: "England" | "Wales";
  endpoint: string;
  fetchImpl?: FetchLike;
}): RouteImporter {
  return {
    source,
    async *fetchRoutes({ maxRoutes, log }: ImporterOptions) {
      const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
      const collection = (await response.json()) as FeatureCollection;
      let yielded = 0;
      for (const feature of collection.features ?? []) {
        if (yielded >= maxRoutes) break;
        const route = parseNationalTrailFeature(feature, country);
        if (!route) continue;
        yielded++;
        yield route;
      }
      log?.(`${source}: ${yielded} routes`);
    },
  };
}

export const nationalTrailsEnglandImporter = createNationalTrailsImporter({
  source: "national_trails_england",
  country: "England",
  endpoint: ENGLAND_ENDPOINT,
});

export const nationalTrailsWalesImporter = createNationalTrailsImporter({
  source: "national_trails_wales",
  country: "Wales",
  endpoint: WALES_ENDPOINT,
});
