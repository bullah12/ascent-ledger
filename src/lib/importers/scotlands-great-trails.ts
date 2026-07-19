import { Discipline } from "@/generated/prisma/enums";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { geometryToLineString } from "./geometry";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

type FetchLike = typeof fetch;

function featureValue(properties: GeoJsonProperties, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties?.[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

export function parseGreatTrailFeature(
  feature: Feature<Geometry, GeoJsonProperties>
): ExternalRoute | null {
  const name = featureValue(feature.properties, ["name", "Name", "title", "Title"]);
  const id =
    feature.id !== undefined
      ? String(feature.id)
      : featureValue(feature.properties, ["id", "ID", "slug", "Slug"]);
  const pathGeojson = geometryToLineString(feature.geometry);
  if (!name || !id || !pathGeojson) return null;
  const sourcePage = featureValue(feature.properties, ["url", "URL", "source_url"]);

  return {
    externalId: id,
    externalUrl:
      sourcePage?.startsWith("https://www.nature.scot/")
        ? sourcePage
        : "https://www.nature.scot/enjoying-outdoors/routes-explore/scotlands-great-trails",
    name,
    discipline: Discipline.hiking,
    gradeSystem: null,
    gradeRaw: null,
    lat: null,
    lng: null,
    lengthM: (() => {
      const distanceKm = Number(featureValue(feature.properties, ["length_km", "distance_km"]));
      return Number.isFinite(distanceKm) && distanceKm > 0 ? Math.round(distanceKm * 1_000) : null;
    })(),
    pitches: null,
    description: featureValue(feature.properties, ["description", "Description"]),
    pathGeojson,
    qualityRating: null,
    area: {
      name: "Scotland's Great Trails",
      region: "Scotland",
      country: "United Kingdom",
    },
  };
}

export function createNatureScotGreatTrailsImporter({
  fetchImpl = fetch,
  dataUrl,
}: {
  fetchImpl?: FetchLike;
  dataUrl?: string;
} = {}): RouteImporter {
  return {
    source: "nature_scot_great_trails",
    async *fetchRoutes({ maxRoutes, log }: ImporterOptions) {
      const url = dataUrl ?? process.env.NATURESCOT_TRAILS_GEOJSON_URL;
      if (!url) {
        throw new Error(
          "NATURESCOT_TRAILS_GEOJSON_URL is not configured; supply an official/licensed GeoJSON distribution"
        );
      }
      if (!/^https:\/\//.test(url)) throw new Error("NatureScot data URL must use HTTPS");
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`NatureScot distribution HTTP ${response.status}`);
      const collection = (await response.json()) as FeatureCollection;
      let yielded = 0;
      for (const feature of collection.features ?? []) {
        if (yielded >= maxRoutes) break;
        const route = parseGreatTrailFeature(feature);
        if (!route) continue;
        yielded++;
        yield route;
      }
      log?.(`nature_scot_great_trails: ${yielded} routes`);
    },
  };
}

export const natureScotGreatTrailsImporter = createNatureScotGreatTrailsImporter();
