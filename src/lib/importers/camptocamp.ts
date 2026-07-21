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
  "rock_climbing",
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
  french_free?: string | null;
  height_diff_difficulties?: number | null;
  height_diff_up?: number | null;
  version?: number;
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
    case "rock_climbing":
      return {
        discipline: Discipline.rock,
        gradeSystem: doc.french_free ? GradeSystem.french_sport : null,
        gradeRaw: doc.french_free ?? null,
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

export function camptocampRoute(
  doc: C2cRouteDoc,
  activity: C2cActivity
): ExternalRoute | null {
  const name = bestTitle(doc.locales);
  if (!name) return null;

  const coords = parseCoords(doc);
  const range = doc.areas.find((a) => a.area_type === "range");
  const country = doc.areas.find((a) => a.area_type === "country");
  const areaName = range ? bestTitle(range.locales) : null;

  const heightDiff = doc.height_diff_up ?? doc.height_diff_difficulties ?? null;

  return {
    externalId: String(doc.document_id),
    externalUrl: `https://www.camptocamp.org/routes/${doc.document_id}`,
    name,
    ...gradeFor(activity, doc),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    lengthM: null,
    ascentM: heightDiff && heightDiff > 0 ? Math.round(heightDiff) : null,
    pitches: null,
    description: null, // list endpoint has summaries only per-locale; skip
    qualityRating: doc.quality ? (QUALITY_SCORES[doc.quality] ?? null) : null,
    licence: "CC BY-SA 3.0 (route text and structured route content; media excluded)",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    attribution: "Camptocamp contributors",
    rawMetadata: { activities: doc.activities, quality: doc.quality, version: doc.version, height_diff_up: doc.height_diff_up, height_diff_difficulties: doc.height_diff_difficulties },
    area: areaName
      ? {
          name: areaName,
          region: null,
          country: country ? bestTitle(country.locales) : null,
        }
      : null,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createCamptocampImporter({
  fetchImpl = fetch,
  sleepImpl = sleep,
}: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> } = {}): RouteImporter {
 return {
  source: "camptocamp",
  precedence: 200,
  defaultLicence: "CC BY-SA 3.0",
  defaultLicenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  defaultAttribution: "Camptocamp contributors",
  activities: ACTIVITIES,

  async *fetchRoutes({ maxRoutes, log, cursor, activity = "all", shard = "europe", snapshotId }: ImporterOptions) {
    // Split the cap across activities so one large category (58k ski
    // routes exist) doesn't starve the others.
    const selectedActivities = activity === "all"
      ? ACTIVITIES
      : ACTIVITIES.filter((candidate) => candidate === activity);
    if (selectedActivities.length === 0) throw new Error(`Unsupported Camptocamp activity: ${activity}`);
    const perActivity = Math.max(1, Math.floor(maxRoutes / selectedActivities.length));
    let yielded = 0;
    const seen = new Set<string>(); // multi-activity routes appear once
    let cursorState: Record<string, number> = {};
    try { cursorState = cursor ? JSON.parse(cursor) as Record<string, number> : {}; } catch { cursorState = {}; }
    const exhausted: string[] = [];

    for (const activity of selectedActivities) {
      let offset = Math.max(0, cursorState[activity] ?? 0);
      let activityCount = 0;

      while (activityCount < perActivity && yielded < maxRoutes) {
        const limit = Math.min(PAGE_SIZE, perActivity - activityCount);
        const areaFilter = shard !== "europe" && /^\d+$/.test(shard) ? `&area=${shard}` : "";
        const response = await fetchImpl(
          `${API_BASE}/routes?act=${activity}&limit=${limit}&offset=${offset}${areaFilter}`,
          { headers: { "user-agent": "Ascent-Ledger route sync (contact: repository maintainers)" }, signal: AbortSignal.timeout(30_000) }
        );
        if (!response.ok) {
          throw new Error(`Camptocamp HTTP ${response.status} for ${activity}`);
        }
        const payload = (await response.json()) as { documents: C2cRouteDoc[] };
        await sleepImpl(REQUEST_DELAY_MS);

        if (payload.documents.length === 0) { exhausted.push(activity); break; }
        offset += payload.documents.length;
        cursorState[activity] = offset;

        for (const doc of payload.documents) {
          if (activityCount >= perActivity || yielded >= maxRoutes) break;
          const externalId = String(doc.document_id);
          if (seen.has(externalId)) continue;
          seen.add(externalId);

          const route = camptocampRoute(doc, activity);
          if (route) {
            activityCount++;
            yielded++;
            yield { ...route, importCursor: JSON.stringify(cursorState) };
          }
        }
      }

      log?.(`camptocamp: ${activity} — ${activityCount} routes`);
    }
    const snapshotComplete = exhausted.length === selectedActivities.length;
    return {
      nextCursor: snapshotComplete ? null : JSON.stringify(cursorState),
      snapshotId: snapshotId ?? new Date().toISOString().slice(0, 10),
      snapshotComplete,
      state: { exhausted },
    };
  },
 };
}

export const camptocampImporter = createCamptocampImporter();
