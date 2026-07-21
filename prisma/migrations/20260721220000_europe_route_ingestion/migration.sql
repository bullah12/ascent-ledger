-- Europe route ingestion: canonical routes, auditable source records, resumable runs.

ALTER TYPE "ascent_ledger"."Discipline" ADD VALUE IF NOT EXISTS 'via_ferrata';
ALTER TYPE "ascent_ledger"."GradeSystem" ADD VALUE IF NOT EXISTS 'via_ferrata_scale';

CREATE TYPE "ascent_ledger"."RouteShape" AS ENUM ('loop', 'out_and_back', 'point_to_point', 'network', 'unknown');
CREATE TYPE "ascent_ledger"."GeometryCompleteness" AS ENUM ('complete', 'incomplete', 'clipped', 'unknown');
CREATE TYPE "ascent_ledger"."SourceRecordStatus" AS ENUM ('active', 'stale');
CREATE TYPE "ascent_ledger"."MergeSuggestionStatus" AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE "ascent_ledger"."ImportRunStatus" AS ENUM ('running', 'succeeded', 'partial', 'failed');

ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN "descent_m" INTEGER,
  ADD COLUMN "calculated_length_m" INTEGER,
  ADD COLUMN "calculated_ascent_m" INTEGER,
  ADD COLUMN "calculated_duration_mins" INTEGER,
  ADD COLUMN "route_shape" "ascent_ledger"."RouteShape" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "route_status" TEXT,
  ADD COLUMN "geometry_completeness" "ascent_ledger"."GeometryCompleteness" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "geometry_segments_json" JSONB,
  ADD COLUMN "localized_names_json" JSONB,
  ADD COLUMN "official_ref" TEXT,
  ADD COLUMN "network" TEXT,
  ADD COLUMN "operator" TEXT,
  ADD COLUMN "canonical_field_meta_json" JSONB;

CREATE TABLE "ascent_ledger"."route_source_records" (
  "id" UUID NOT NULL,
  "route_id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "source_shard" TEXT NOT NULL DEFAULT 'default',
  "source_activity" TEXT NOT NULL DEFAULT 'all',
  "external_id" TEXT NOT NULL,
  "external_url" TEXT NOT NULL,
  "licence" TEXT NOT NULL,
  "licence_url" TEXT,
  "attribution" TEXT NOT NULL,
  "raw_metadata_json" JSONB,
  "field_provenance_json" JSONB,
  "source_updated_at" TIMESTAMP(3),
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "import_snapshot" TEXT,
  "import_checkpoint" TEXT,
  "geometry_geojson" JSONB,
  "geometry_completeness" "ascent_ledger"."GeometryCompleteness" NOT NULL DEFAULT 'unknown',
  "geometry_segments_json" JSONB,
  "source_name" TEXT NOT NULL,
  "source_grade_raw" TEXT,
  "source_distance_m" INTEGER,
  "source_ascent_m" INTEGER,
  "source_descent_m" INTEGER,
  "status" "ascent_ledger"."SourceRecordStatus" NOT NULL DEFAULT 'active',
  "stale_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "route_source_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "route_source_records_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "route_source_records_source_external_id_key" ON "ascent_ledger"."route_source_records"("source", "external_id");
CREATE INDEX "route_source_records_route_id_status_idx" ON "ascent_ledger"."route_source_records"("route_id", "status");
CREATE INDEX "route_source_records_source_status_idx" ON "ascent_ledger"."route_source_records"("source", "status");
CREATE INDEX "route_source_records_source_source_shard_source_activity_status_idx" ON "ascent_ledger"."route_source_records"("source", "source_shard", "source_activity", "status");

-- Backfill legacy provenance without changing canonical route IDs.
INSERT INTO "ascent_ledger"."route_source_records" (
  "id", "route_id", "source", "external_id", "external_url", "licence", "attribution",
  "first_seen_at", "last_seen_at", "source_name", "source_grade_raw", "source_distance_m",
  "source_ascent_m", "geometry_geojson", "geometry_completeness", "updated_at"
)
SELECT gen_random_uuid(), r."id", r."external_source", r."external_id",
       COALESCE(r."external_url", ''), 'Legacy source terms — verify in source registry', r."external_source",
       r."created_at", COALESCE(r."last_synced_at", r."updated_at"), r."name", r."grade_raw", r."length_m",
       r."ascent_m", r."path_geojson",
       CASE WHEN r."path_geojson" IS NULL THEN 'unknown'::"ascent_ledger"."GeometryCompleteness" ELSE 'complete'::"ascent_ledger"."GeometryCompleteness" END,
       CURRENT_TIMESTAMP
FROM "ascent_ledger"."routes" r
WHERE r."external_source" IS NOT NULL AND r."external_source" <> 'manual' AND r."external_id" IS NOT NULL
ON CONFLICT ("source", "external_id") DO NOTHING;

CREATE TABLE "ascent_ledger"."route_merge_suggestions" (
  "id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "primary_route_id" UUID NOT NULL,
  "candidate_route_id" UUID NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "reasons_json" JSONB NOT NULL,
  "status" "ascent_ledger"."MergeSuggestionStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "route_merge_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "route_merge_suggestions_primary_route_id_fkey" FOREIGN KEY ("primary_route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "route_merge_suggestions_candidate_route_id_fkey" FOREIGN KEY ("candidate_route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "route_merge_suggestions_source_external_id_candidate_route_id_key" ON "ascent_ledger"."route_merge_suggestions"("source", "external_id", "candidate_route_id");
CREATE INDEX "route_merge_suggestions_status_score_idx" ON "ascent_ledger"."route_merge_suggestions"("status", "score");

ALTER TABLE "ascent_ledger"."route_import_logs"
  ADD COLUMN "routes_merged" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "suggestions_created" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "routes_stale" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shard" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "activity" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN "snapshot_id" TEXT,
  ADD COLUMN "cursor_start" TEXT,
  ADD COLUMN "cursor_end" TEXT,
  ADD COLUMN "snapshot_complete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" "ascent_ledger"."ImportRunStatus" NOT NULL DEFAULT 'succeeded',
  ADD COLUMN "finished_at" TIMESTAMP(3);

CREATE TABLE "ascent_ledger"."route_import_checkpoints" (
  "id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "shard" TEXT NOT NULL DEFAULT 'default',
  "activity" TEXT NOT NULL DEFAULT 'all',
  "cursor" TEXT,
  "snapshot_id" TEXT,
  "etag" TEXT,
  "checksum" TEXT,
  "state_json" JSONB,
  "last_success_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "route_import_checkpoints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "route_import_checkpoints_source_shard_activity_key" ON "ascent_ledger"."route_import_checkpoints"("source", "shard", "activity");
