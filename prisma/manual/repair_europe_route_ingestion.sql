-- Repair for migration 20260721220000_europe_route_ingestion.
--
-- Use when the migration was recorded as applied before all of its database
-- objects were created. This script is intentionally idempotent so it can be
-- run after a partial/manual application.

ALTER TYPE "ascent_ledger"."Discipline" ADD VALUE IF NOT EXISTS 'via_ferrata';
ALTER TYPE "ascent_ledger"."GradeSystem" ADD VALUE IF NOT EXISTS 'via_ferrata_scale';

DO $repair_types$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ascent_ledger' AND t.typname = 'RouteShape'
  ) THEN
    CREATE TYPE "ascent_ledger"."RouteShape" AS ENUM
      ('loop', 'out_and_back', 'point_to_point', 'network', 'unknown');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ascent_ledger' AND t.typname = 'GeometryCompleteness'
  ) THEN
    CREATE TYPE "ascent_ledger"."GeometryCompleteness" AS ENUM
      ('complete', 'incomplete', 'clipped', 'unknown');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ascent_ledger' AND t.typname = 'SourceRecordStatus'
  ) THEN
    CREATE TYPE "ascent_ledger"."SourceRecordStatus" AS ENUM
      ('active', 'stale');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ascent_ledger' AND t.typname = 'MergeSuggestionStatus'
  ) THEN
    CREATE TYPE "ascent_ledger"."MergeSuggestionStatus" AS ENUM
      ('pending', 'accepted', 'rejected');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'ascent_ledger' AND t.typname = 'ImportRunStatus'
  ) THEN
    CREATE TYPE "ascent_ledger"."ImportRunStatus" AS ENUM
      ('running', 'succeeded', 'partial', 'failed');
  END IF;
END
$repair_types$;

ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN IF NOT EXISTS "descent_m" INTEGER,
  ADD COLUMN IF NOT EXISTS "calculated_length_m" INTEGER,
  ADD COLUMN IF NOT EXISTS "calculated_ascent_m" INTEGER,
  ADD COLUMN IF NOT EXISTS "calculated_duration_mins" INTEGER,
  ADD COLUMN IF NOT EXISTS "route_shape" "ascent_ledger"."RouteShape" NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "route_status" TEXT,
  ADD COLUMN IF NOT EXISTS "geometry_completeness" "ascent_ledger"."GeometryCompleteness" NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "geometry_segments_json" JSONB,
  ADD COLUMN IF NOT EXISTS "localized_names_json" JSONB,
  ADD COLUMN IF NOT EXISTS "official_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "network" TEXT,
  ADD COLUMN IF NOT EXISTS "operator" TEXT,
  ADD COLUMN IF NOT EXISTS "canonical_field_meta_json" JSONB;

CREATE TABLE IF NOT EXISTS "ascent_ledger"."route_source_records" (
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
  CONSTRAINT "route_source_records_route_id_fkey"
    FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "route_source_records_source_external_id_key"
  ON "ascent_ledger"."route_source_records"("source", "external_id");
CREATE INDEX IF NOT EXISTS "route_source_records_route_id_status_idx"
  ON "ascent_ledger"."route_source_records"("route_id", "status");
CREATE INDEX IF NOT EXISTS "route_source_records_source_status_idx"
  ON "ascent_ledger"."route_source_records"("source", "status");
CREATE INDEX IF NOT EXISTS "route_source_records_source_source_shard_source_activity_status_idx"
  ON "ascent_ledger"."route_source_records"("source", "source_shard", "source_activity", "status");

-- Restore provenance for routes that existed before source records were added.
INSERT INTO "ascent_ledger"."route_source_records" (
  "id", "route_id", "source", "external_id", "external_url", "licence", "attribution",
  "first_seen_at", "last_seen_at", "source_name", "source_grade_raw", "source_distance_m",
  "source_ascent_m", "geometry_geojson", "geometry_completeness", "updated_at"
)
SELECT
  gen_random_uuid(), r."id", r."external_source", r."external_id",
  COALESCE(r."external_url", ''),
  'Legacy source terms — verify in source registry',
  r."external_source", r."created_at", COALESCE(r."last_synced_at", r."updated_at"),
  r."name", r."grade_raw", r."length_m", r."ascent_m", r."path_geojson",
  CASE
    WHEN r."path_geojson" IS NULL
      THEN 'unknown'::"ascent_ledger"."GeometryCompleteness"
    ELSE 'complete'::"ascent_ledger"."GeometryCompleteness"
  END,
  CURRENT_TIMESTAMP
FROM "ascent_ledger"."routes" r
WHERE r."external_source" IS NOT NULL
  AND r."external_source" <> 'manual'
  AND r."external_id" IS NOT NULL
ON CONFLICT ("source", "external_id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "ascent_ledger"."route_merge_suggestions" (
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
  CONSTRAINT "route_merge_suggestions_primary_route_id_fkey"
    FOREIGN KEY ("primary_route_id") REFERENCES "ascent_ledger"."routes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "route_merge_suggestions_candidate_route_id_fkey"
    FOREIGN KEY ("candidate_route_id") REFERENCES "ascent_ledger"."routes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "route_merge_suggestions_source_external_id_candidate_route_id_key"
  ON "ascent_ledger"."route_merge_suggestions"("source", "external_id", "candidate_route_id");
CREATE INDEX IF NOT EXISTS "route_merge_suggestions_status_score_idx"
  ON "ascent_ledger"."route_merge_suggestions"("status", "score");

ALTER TABLE "ascent_ledger"."route_import_logs"
  ADD COLUMN IF NOT EXISTS "routes_merged" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "suggestions_created" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "routes_stale" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shard" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS "activity" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS "snapshot_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cursor_start" TEXT,
  ADD COLUMN IF NOT EXISTS "cursor_end" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_complete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "status" "ascent_ledger"."ImportRunStatus" NOT NULL DEFAULT 'succeeded',
  ADD COLUMN IF NOT EXISTS "finished_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ascent_ledger"."route_import_checkpoints" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "route_import_checkpoints_source_shard_activity_key"
  ON "ascent_ledger"."route_import_checkpoints"("source", "shard", "activity");

-- Fail visibly if any core ingestion object is still absent.
DO $verify_repair$
BEGIN
  IF to_regclass('ascent_ledger.route_source_records') IS NULL THEN
    RAISE EXCEPTION 'route_source_records was not created';
  END IF;
  IF to_regclass('ascent_ledger.route_merge_suggestions') IS NULL THEN
    RAISE EXCEPTION 'route_merge_suggestions was not created';
  END IF;
  IF to_regclass('ascent_ledger.route_import_checkpoints') IS NULL THEN
    RAISE EXCEPTION 'route_import_checkpoints was not created';
  END IF;
END
$verify_repair$;
