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
  const name = featureValue(feature.properties, ["Trail", "name", "Name", "title", "Title"]);
  const id =
    feature.id !== undefined
      ? String(feature.id)
      : featureValue(feature.properties, ["OBJECTID", "GlobalID", "id", "ID", "slug", "Slug"]);
  const pathGeojson = geometryToLineString(feature.geometry);
  if (!name || !id || !pathGeojson) return null;
  const sourcePage = featureValue(feature.properties, ["Website", "url", "URL", "source_url"]);

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
      const distanceKm = Number(featureValue(feature.properties, ["Kilometers", "length_km", "distance_km"]));
      return Number.isFinite(distanceKm) && distanceKm > 0 ? Math.round(distanceKm * 1_000) : null;
    })(),
    pitches: null,
    description: featureValue(feature.properties, ["description", "Description"]),
    pathGeojson,
    geometryCompleteness: "complete",
    qualityRating: null,
    rawMetadata: { ...feature.properties },
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
  licence,
}: {
  fetchImpl?: FetchLike;
  dataUrl?: string;
  licence?: string;
} = {}): RouteImporter {
  return {
    source: "nature_scot_great_trails",
    async *fetchRoutes({ maxRoutes, log, cursor }: ImporterOptions) {
      const url = dataUrl ?? process.env.NATURESCOT_TRAILS_GEOJSON_URL;
      const confirmedLicence = licence ?? process.env.NATURESCOT_TRAILS_LICENCE;
      if (!url) {
        throw new Error(
          "NATURESCOT_TRAILS_GEOJSON_URL is not configured; supply an official/licensed GeoJSON distribution"
        );
      }
      if (!confirmedLicence) {
        throw new Error("NATURESCOT_TRAILS_LICENCE is not configured; confirm the external distribution's reusable licence");
      }
      if (!/^https:\/\//.test(url)) throw new Error("NatureScot data URL must use HTTPS");
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`NatureScot distribution HTTP ${response.status}`);
      const collection = (await response.json()) as FeatureCollection;
      let yielded = 0;
      const features = collection.features ?? [];
      const offset = Math.max(0, Number(cursor ?? 0) || 0);
      const selected = features.slice(offset, offset + maxRoutes);
      for (let index = 0; index < selected.length; index++) {
        const feature = selected[index];
        const route = parseGreatTrailFeature(feature);
        if (!route) continue;
        yielded++;
        yield {
          ...route,
          importCursor: String(offset + index + 1),
          licence: confirmedLicence,
          licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
          attribution: "NatureScot / Scotland's Great Trails; contains Ordnance Survey data",
        };
      }
      log?.(`nature_scot_great_trails: ${yielded} routes`);
      const nextOffset = offset + selected.length;
      const complete = nextOffset >= features.length;
      return { nextCursor: complete ? null : String(nextOffset), snapshotId: response.headers.get("etag") ?? new Date().toISOString().slice(0, 10), snapshotComplete: complete, etag: response.headers.get("etag") };
    },
  };
}

export const natureScotGreatTrailsImporter = createNatureScotGreatTrailsImporter();
