import type { Discipline, GradeSystem } from "@/generated/prisma/enums";
import type { LineString } from "geojson";

export type GeometryCompletenessValue = "complete" | "incomplete" | "clipped" | "unknown";
export type RouteShapeValue = "loop" | "out_and_back" | "point_to_point" | "network" | "unknown";

export type RouteSegment = {
  role: string;
  memberType?: "way" | "relation";
  memberId?: string;
  geometry: LineString | null;
  complete: boolean;
};

export type DifficultyDerivation = {
  derived: boolean;
  method: string;
  rawValues: string[];
};

export type ExternalRoute = {
  externalId: string;
  externalUrl: string;
  name: string;
  localizedNames?: Record<string, string>;
  discipline: Discipline;
  gradeSystem: GradeSystem | null;
  gradeRaw: string | null;
  difficultyDerivation?: DifficultyDerivation | null;
  lat: number | null;
  lng: number | null;
  lengthM: number | null;
  calculatedLengthM?: number | null;
  ascentM?: number | null;
  descentM?: number | null;
  calculatedAscentM?: number | null;
  estimatedDurationMins?: number | null;
  calculatedDurationMins?: number | null;
  routeShape?: RouteShapeValue;
  routeStatus?: string | null;
  pitches: number | null;
  description: string | null;
  pathGeojson?: LineString | null;
  geometrySegments?: RouteSegment[];
  geometryCompleteness?: GeometryCompletenessValue;
  qualityRating: number | null;
  officialRef?: string | null;
  network?: string | null;
  operator?: string | null;
  wikidata?: string | null;
  website?: string | null;
  sourceUpdatedAt?: Date | null;
  licence?: string;
  licenceUrl?: string;
  attribution?: string;
  rawMetadata?: Record<string, unknown>;
  importCursor?: string;
  area: {
    name: string;
    region: string | null;
    country: string | null;
  } | null;
};

export type ImporterCompletion = {
  nextCursor: string | null;
  snapshotId: string;
  snapshotComplete: boolean;
  etag?: string | null;
  checksum?: string | null;
  state?: Record<string, unknown>;
};

export type ImporterOptions = {
  maxRoutes: number;
  cursor?: string | null;
  shard?: string;
  activity?: string;
  snapshotId?: string | null;
  localFile?: string;
  log?: (message: string) => void;
};

export type RouteImporter = {
  source: string;
  /** Higher values win canonical fields unless a user has edited that field. */
  precedence?: number;
  defaultLicence?: string;
  defaultLicenceUrl?: string;
  defaultAttribution?: string;
  shards?: readonly string[];
  activities?: readonly string[];
  fetchRoutes(options: ImporterOptions): AsyncGenerator<ExternalRoute, ImporterCompletion | void>;
};
