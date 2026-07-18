import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

// Camptocamp (camptocamp.org) — public API, CC BY-SA licensed content,
// strong Alps coverage for alpine, ski touring, and winter mountaineering
// (PLAN.md §5 point 1). Attribution is preserved via external_url; content
// stays cached locally and is re-synced on schedule rather than fetched
// live (§5 point 3).
//
// Activity → discipline/grade mapping:
//   mountain_climbing → alpine,      alpine_overall (global_rating, "AD+")
//   skitouring        → ski_touring, ski_touring_scale (labande_global_rating, "AD-")
//   ice_climbing      → winter,      wi_ice (ice_rating, "4+")
//   snow_ice_mixed    → winter,      alpine_overall (global_rating)

const API_BASE = "https://api.camptocamp.org";
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 500;

const ACTIVITIES = [
  "mountain_climbing",
  "skitouring",
  "ice_climbing",
  "snow_ice_mixed",
] as const;

type C2cActivity = (typeof ACTIVITIES)[number];

type C2cLocale = { lang: string; title: string };

type C2cAreaDoc = {
  area_type: "range" | "country" | "admin_limits";
  locales: C2cLocale[];
};

type C2cRouteDoc = {
  document_id: number;
  locales: C2cLocale[];
  activities: string[];
  geometry: { geom: string | null } | null;
  areas: C2cAreaDoc[];
  quality: string | null;
  global_rating?: string | null;
  labande_global_rating?: string | null;
  ice_rating?: string | null;
  ski_rating?: string | null;
  height_diff_difficulties?: number | null;
  height_diff_up?: number | null;
};

function bestTitle(locales: C2cLocale[]): string | null {
  const preferred =
    locales.find((l) => l.lang === "en") ??
    locales.find((l) => l.lang === "fr") ??
    locales[0];
  return preferred?.title.trim() || null;
}

// c2c geometries are EPSG:3857 (web mercator) point coords.
function mercatorToWgs84(x: number, y: number): { lat: number; lng: number } {
  const R = 6378137;
  const lng = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lng };
}

function parseCoords(doc: C2cRouteDoc): { lat: number; lng: number } | null {
  const geomText = doc.geometry?.geom;
  if (!geomText) return null;
  try {
    const geom = JSON.parse(geomText) as { type: string; coordinates: number[] };
    if (geom.type !== "Point" || geom.coordinates.length < 2) return null;
    return mercatorToWgs84(geom.coordinates[0], geom.coordinates[1]);
  } catch {
    return null;
  }
}

const QUALITY_SCORES: Record<string, number> = {
  empty: 1,
  draft: 2,
  medium: 3,
  fine: 4,
  great: 5,
};

function gradeFor(
  activity: C2cActivity,
  doc: C2cRouteDoc
): { discipline: Discipline; gradeSystem: GradeSystem | null; gradeRaw: string | null } {
  switch (activity) {
    case "mountain_climbing":
      return {
        discipline: Discipline.alpine,
        gradeSystem: doc.global_rating ? GradeSystem.alpine_overall : null,
        gradeRaw: doc.global_rating ?? null,
      };
    case "skitouring": {
      // Prefer the Labande overall rating (F…ED — parses on our ladder);
      // fall back to the Toponeige number ("3.2"), stored unscored.
      const raw = doc.labande_global_rating ?? doc.ski_rating ?? null;
      return {
        discipline: Discipline.ski_touring,
        gradeSystem: raw ? GradeSystem.ski_touring_scale : null,
        gradeRaw: raw,
      };
    }
    case "ice_climbing":
      return {
        discipline: Discipline.winter,
        gradeSystem: doc.ice_rating ? GradeSystem.wi_ice : null,
        gradeRaw: doc.ice_rating ?? null,
      };
    case "snow_ice_mixed":
      return {
        discipline: Discipline.winter,
        gradeSystem: doc.global_rating ? GradeSystem.alpine_overall : null,
        gradeRaw: doc.global_rating ?? null,
      };
  }
}

function toExternalRoute(
  doc: C2cRouteDoc,
  activity: C2cActivity
): ExternalRoute | null {
  const name = bestTitle(doc.locales);
  if (!name) return null;

  const coords = parseCoords(doc);
  const range = doc.areas.find((a) => a.area_type === "range");
  const country = doc.areas.find((a) => a.area_type === "country");
  const areaName = range ? bestTitle(range.locales) : null;

  const heightDiff = doc.height_diff_difficulties ?? doc.height_diff_up ?? null;

  return {
    externalId: String(doc.document_id),
    externalUrl: `https://www.camptocamp.org/routes/${doc.document_id}`,
    name,
    ...gradeFor(activity, doc),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    lengthM: heightDiff && heightDiff > 0 ? Math.round(heightDiff) : null,
    pitches: null,
    description: null, // list endpoint has summaries only per-locale; skip
    qualityRating: doc.quality ? (QUALITY_SCORES[doc.quality] ?? null) : null,
    area: areaName
      ? {
          name: areaName,
          region: null,
          country: country ? bestTitle(country.locales) : null,
        }
      : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const camptocampImporter: RouteImporter = {
  source: "camptocamp",

  async *fetchRoutes({ maxRoutes, log }: ImporterOptions) {
    // Split the cap across activities so one large category (58k ski
    // routes exist) doesn't starve the others.
    const perActivity = Math.max(1, Math.floor(maxRoutes / ACTIVITIES.length));
    let yielded = 0;
    const seen = new Set<string>(); // multi-activity routes appear once

    for (const activity of ACTIVITIES) {
      let offset = 0;
      let activityCount = 0;

      while (activityCount < perActivity && yielded < maxRoutes) {
        const limit = Math.min(PAGE_SIZE, perActivity - activityCount);
        const response = await fetch(
          `${API_BASE}/routes?act=${activity}&limit=${limit}&offset=${offset}`
        );
        if (!response.ok) {
          throw new Error(`Camptocamp HTTP ${response.status} for ${activity}`);
        }
        const payload = (await response.json()) as { documents: C2cRouteDoc[] };
        await sleep(REQUEST_DELAY_MS);

        if (payload.documents.length === 0) break;
        offset += payload.documents.length;

        for (const doc of payload.documents) {
          if (activityCount >= perActivity || yielded >= maxRoutes) break;
          const externalId = String(doc.document_id);
          if (seen.has(externalId)) continue;
          seen.add(externalId);

          const route = toExternalRoute(doc, activity);
          if (route) {
            activityCount++;
            yielded++;
            yield route;
          }
        }
      }

      log?.(`camptocamp: ${activity} — ${activityCount} routes`);
    }
  },
};
