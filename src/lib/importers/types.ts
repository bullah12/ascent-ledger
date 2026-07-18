import type { Discipline, GradeSystem } from "@/generated/prisma/enums";

// Pluggable importer interface (PLAN.md §5 point 4): one adapter per
// source, each yielding source-agnostic ExternalRoute records. Adding a
// new source means adding one file that implements RouteImporter — the
// sync runner never changes.

export type ExternalRoute = {
  /** Stable id within the source; upsert key is (source, externalId). */
  externalId: string;
  /** Public page for attribution/deep-linking (PLAN.md §5 point 3);
   *  null for hand-curated data with no source page. */
  externalUrl: string | null;
  name: string;
  discipline: Discipline;
  gradeSystem: GradeSystem | null;
  gradeRaw: string | null;
  lat: number | null;
  lng: number | null;
  lengthM: number | null;
  pitches: number | null;
  description: string | null;
  /** 1–5 if the source rates quality, else null. */
  qualityRating: number | null;
  area: {
    name: string;
    region: string | null;
    country: string | null;
  } | null;
};

export type ImporterOptions = {
  /** Hard cap on routes fetched per run — be a polite API citizen. */
  maxRoutes: number;
  log?: (message: string) => void;
};

export type RouteImporter = {
  /** Stored in Route.externalSource and RouteImportLog.source. */
  source: string;
  fetchRoutes(options: ImporterOptions): AsyncGenerator<ExternalRoute>;
};
