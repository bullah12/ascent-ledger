import { Discipline } from "@/generated/prisma/enums";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, LineString } from "geojson";
import { geometryLineParts, geodesicLengthM } from "./geometry";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

type OfficialSourceConfig = {
  source: string;
  label: string;
  endpoint: string | (() => string | undefined);
  sourceUrl: string;
  country: string;
  region?: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  precedence?: number;
  requestMode?: "collection" | "arcgis";
};

function value(properties: GeoJsonProperties, keys: string[]) {
  for (const key of keys) {
    const candidate = properties?.[key];
    if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) return String(candidate).trim();
  }
  return null;
}

function dateValue(properties: GeoJsonProperties, keys: string[]) {
  const raw = value(properties, keys);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function geometry(feature: Feature<Geometry, GeoJsonProperties>) {
  const parts = geometryLineParts(feature.geometry).filter((part) => part.length >= 2);
  const canonical: LineString | null = parts[0] ? { type: "LineString", coordinates: parts[0] } : null;
  return {
    canonical,
    segments: parts.map((coordinates, index) => ({ role: index === 0 ? "main" : "section", geometry: { type: "LineString" as const, coordinates }, complete: true })),
  };
}

function disciplineFor(properties: GeoJsonProperties): Discipline | null {
  const activity = value(properties, ["activity", "Activity", "aktivitet", "AKTIVITET", "Typ_av_led", "LTYP", "type", "Type", "route_type", "sportsSiteType", "@type"])?.toLowerCase() ?? "hiking";
  if (/cycl|cykel|bike/.test(activity) && !/walk|hik|foot|ski|mountain|ferrata/.test(activity)) return null;
  if (/via.?ferrata/.test(activity)) return Discipline.via_ferrata;
  if (/ski|skiløype|hiihto/.test(activity)) return Discipline.ski_touring;
  if (/mountain|alpin|bergsteigen/.test(activity)) return Discipline.alpine;
  if (/climb|escalade/.test(activity)) return Discipline.rock;
  if (/walk|hik|foot|vand|promenade|retkeily|outdoor|trail|hiking/.test(activity)) return Discipline.hiking;
  return Discipline.hiking;
}

export function parseOfficialRouteFeature(
  feature: Feature<Geometry, GeoJsonProperties>,
  config: Pick<OfficialSourceConfig, "source" | "sourceUrl" | "country" | "region" | "licence" | "licenceUrl" | "attribution" | "label">
): ExternalRoute | null {
  const name = value(feature.properties, ["Trail", "Lednamn", "LNAMN", "Statlig_led_namn", "STLED_NAMN", "name", "Name", "NAME", "namn", "Namn", "nimi", "NAMN", "navn", "NAVN", "title", "label", "rdfs:label"]);
  const id = feature.id !== undefined ? String(feature.id) : value(feature.properties, ["Led_ID", "L_ID", "GlobalID", "globalid", "OBJECTID", "objectid", "id", "ID", "lokalId", "lipasId", "identifier"]);
  const routeGeometry = geometry(feature);
  const discipline = disciplineFor(feature.properties);
  if (!name || !id || !routeGeometry.canonical || !discipline) return null;
  const distanceM = Number(value(feature.properties, ["Längd_på_led_m", "LLANGD", "length_m", "distance_m"]));
  const distanceKm = Number(value(feature.properties, ["Kilometers", "kilometers", "length_km", "distance_km", "pituusKm"]));
  const officialDistance = Number.isFinite(distanceM) && distanceM > 0
    ? Math.round(distanceM)
    : Number.isFinite(distanceKm) && distanceKm > 0
      ? Math.round(distanceKm * 1_000)
      : null;
  const url = value(feature.properties, ["Website", "website", "url", "URL", "webpage"]);
  return {
    externalId: id,
    externalUrl: url?.startsWith("http") ? url : config.sourceUrl,
    name,
    discipline,
    gradeSystem: null,
    gradeRaw: value(feature.properties, ["difficulty", "Difficulty", "vanskelighetsgrad", "svårighetsgrad"]),
    lat: null,
    lng: null,
    lengthM: officialDistance,
    calculatedLengthM: officialDistance ? null : geodesicLengthM(routeGeometry.canonical),
    ascentM: Number(value(feature.properties, ["ascent", "ascentM", "elevationGain"])) || null,
    descentM: Number(value(feature.properties, ["descent", "descentM", "elevationLoss"])) || null,
    pitches: null,
    description: value(feature.properties, ["Description", "description", "Beskrivning", "BESKRIVN", "beskrivning", "kuvaus"]),
    pathGeojson: routeGeometry.canonical,
    geometrySegments: routeGeometry.segments,
    geometryCompleteness: "complete",
    routeStatus: value(feature.properties, ["status", "Status", "publiceringsstatus"]),
    qualityRating: null,
    officialRef: value(feature.properties, ["ref", "reference", "routeNumber"]),
    operator: value(feature.properties, ["operator", "owner", "maintainer", "sourceOwner", "hasBeenCreatedBy"]),
    sourceUpdatedAt: dateValue(feature.properties, ["lastUpdate", "updated", "updatedAt", "oppdateringsdato"]),
    licence: config.licence,
    licenceUrl: config.licenceUrl,
    attribution: config.attribution,
    rawMetadata: { ...feature.properties },
    area: { name: config.label, region: config.region ?? null, country: config.country },
  };
}

export function createOfficialGeoJsonImporter(config: OfficialSourceConfig, fetchImpl: typeof fetch = fetch): RouteImporter {
  return {
    source: config.source,
    precedence: config.precedence ?? 400,
    defaultLicence: config.licence,
    defaultLicenceUrl: config.licenceUrl,
    defaultAttribution: config.attribution,
    async *fetchRoutes({ maxRoutes, cursor, snapshotId }: ImporterOptions) {
      const endpoint = typeof config.endpoint === "function" ? config.endpoint() : config.endpoint;
      if (!endpoint) throw new Error(`${config.source} endpoint is not configured; set the documented official GeoJSON URL`);
      const offset = Math.max(0, Number(cursor ?? 0) || 0);
      const url = config.requestMode === "arcgis"
        ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}resultOffset=${offset}&resultRecordCount=${maxRoutes}`
        : endpoint;
      const response = await fetchImpl(url, {
        headers: { "user-agent": "Ascent-Ledger route sync (contact: repository maintainers)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${config.source} HTTP ${response.status}`);
      const collection = await response.json() as FeatureCollection;
      const features = config.requestMode === "arcgis"
        ? collection.features ?? []
        : (collection.features ?? []).slice(offset, offset + maxRoutes);
      let yielded = 0;
      for (const feature of features) {
        const route = parseOfficialRouteFeature(feature, config);
        if (!route) continue;
        yielded++;
        yield { ...route, importCursor: String(offset + yielded) };
      }
      const complete = config.requestMode === "arcgis" ? features.length < maxRoutes : offset + maxRoutes >= (collection.features?.length ?? 0);
      return {
        nextCursor: complete ? null : String(offset + features.length),
        snapshotId: snapshotId ?? response.headers.get("etag") ?? new Date().toISOString().slice(0, 10),
        snapshotComplete: complete,
        etag: response.headers.get("etag"),
      };
    },
  };
}

const OGL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

export const englandCoastPathImporter = createOfficialGeoJsonImporter({
  source: "england_coast_path",
  label: "King Charles III England Coast Path",
  endpoint: "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/England_Coast_Path_Route/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
  sourceUrl: "https://environment.data.gov.uk/dataset/4006f956-f491-4ca9-ab01-d8c96e873165",
  country: "United Kingdom",
  region: "England",
  licence: "Open Government Licence v3.0",
  licenceUrl: OGL,
  attribution: "© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right 2026.",
  requestMode: "arcgis",
});

export const swedenTrailsImporter = createOfficialGeoJsonImporter({
  source: "sweden_naturvardsverket",
  label: "Naturvårdsverket trails",
  endpoint: "https://geodata.naturvardsverket.se/nedladdning/friluftsliv/Leder.geojson",
  sourceUrl: "https://geodata.naturvardsverket.se/friluftsliv/rest/v2/",
  country: "Sweden",
  licence: "CC0 1.0",
  licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "Source: Naturvårdsverket and the source owner recorded on each trail",
});

export const finlandLipasImporter = createOfficialGeoJsonImporter({
  source: "finland_lipas",
  label: "LIPAS outdoor routes",
  endpoint: () => process.env.LIPAS_ROUTES_GEOJSON_URL,
  sourceUrl: "https://api.lipas.fi/v2/",
  country: "Finland",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Sports facilities: Lipas.fi, University of Jyväskylä, retrieval date",
});

export const norwayTrailsImporter = createOfficialGeoJsonImporter({
  source: "norway_kartverket_trails",
  label: "Kartverket national route database",
  endpoint: () => process.env.NORWAY_TRAILS_GEOJSON_URL,
  sourceUrl: "https://www.kartverket.no/geodataarbeid/dok-og-temadata/turruter",
  country: "Norway",
  licence: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  licenceUrl: "https://data.norge.no/nlod/no/2.0",
  attribution: "© Kartverket; route owner/maintainer retained per record",
});

export const swissWanderlandImporter = createOfficialGeoJsonImporter({
  source: "swiss_wanderland",
  label: "Wanderland Schweiz named routes",
  endpoint: () => process.env.SWISS_WANDERLAND_GEOJSON_URL,
  sourceUrl: "https://opendata.swiss/en/dataset/swisstlm3d-wanderwege",
  country: "Switzerland",
  licence: "opendata.swiss open use — source attribution required",
  licenceUrl: "https://opendata.swiss/en/terms-of-use",
  attribution: "Federal Office of Topography swisstopo; title and dataset link",
});
