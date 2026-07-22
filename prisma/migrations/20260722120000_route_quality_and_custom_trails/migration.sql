-- Route quality, moderation, and strict separation of private custom trails.
-- Existing canonical route IDs and every user-owned relationship are retained.

CREATE TYPE "ascent_ledger"."RouteOrigin" AS ENUM ('imported', 'legacy_user_created');
CREATE TYPE "ascent_ledger"."RoutePublicationState" AS ENUM ('approved', 'quarantined', 'rejected', 'pending_review');
CREATE TYPE "ascent_ledger"."RouteVerificationStatus" AS ENUM ('verified', 'unverified', 'failed');
CREATE TYPE "ascent_ledger"."ModerationAction" AS ENUM ('classified', 'approved', 'quarantined', 'rejected');

ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN "origin" "ascent_ledger"."RouteOrigin" NOT NULL DEFAULT 'imported',
  ADD COLUMN "publication_state" "ascent_ledger"."RoutePublicationState" NOT NULL DEFAULT 'pending_review',
  ADD COLUMN "verification_status" "ascent_ledger"."RouteVerificationStatus" NOT NULL DEFAULT 'unverified',
  ADD COLUMN "verification_reason" TEXT,
  ADD COLUMN "quality_score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quality_signals_json" JSONB,
  ADD COLUMN "moderation_reason" TEXT,
  ADD COLUMN "source_authority" TEXT,
  ADD COLUMN "policy_version" TEXT,
  ADD COLUMN "moderated_at" TIMESTAMP(3),
  ADD COLUMN "moderation_locked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ascent_ledger"."routes"
  ADD CONSTRAINT "routes_quality_score_check" CHECK ("quality_score" BETWEEN 0 AND 100);

CREATE INDEX "routes_publication_state_origin_idx"
  ON "ascent_ledger"."routes"("publication_state", "origin");

-- The small, explicit agency allowlist can be approved safely in-migration.
-- Everything else is hidden until the versioned policy backfill evaluates it.
UPDATE "ascent_ledger"."routes"
SET "publication_state" = 'approved',
    "verification_status" = 'verified',
    "quality_score" = 100,
    "source_authority" = "external_source",
    "verification_reason" = 'Explicit official-agency source allowlist',
    "moderation_reason" = 'Initial safe agency-source classification',
    "policy_version" = 'route-quality-v1',
    "moderated_at" = CURRENT_TIMESTAMP
WHERE "external_source" IN (
  'national_trails_england', 'national_trails_wales',
  'nature_scot_great_trails', 'england_coast_path',
  'sweden_naturvardsverket', 'finland_lipas',
  'norway_kartverket_trails', 'swiss_wanderland',
  'france_datatourisme'
)
  AND BTRIM("name") <> ''
  AND "path_geojson" IS NOT NULL
  AND COALESCE("length_m", "calculated_length_m", 0) >= 100
  AND "geometry_completeness" NOT IN ('clipped', 'incomplete');

UPDATE "ascent_ledger"."routes"
SET "origin" = 'legacy_user_created',
    "publication_state" = 'quarantined',
    "verification_status" = 'unverified',
    "verification_reason" = 'Legacy user-created route has no recoverable owner',
    "moderation_reason" = 'Preserved for existing references; excluded from public catalogue',
    "policy_version" = 'route-quality-v1',
    "moderated_at" = CURRENT_TIMESTAMP
WHERE "external_source" = 'manual' OR "external_source" IS NULL;

-- Starter packs are a versioned, human-curated verification set. Preserve
-- that explicit moderation decision across future community-source syncs.
UPDATE "ascent_ledger"."routes"
SET "origin" = 'imported',
    "publication_state" = 'approved',
    "verification_status" = 'verified',
    "quality_score" = 100,
    "verification_reason" = 'Manually verified starter seed',
    "moderation_reason" = 'Curated onboarding starter route',
    "source_authority" = COALESCE("external_source", 'starter seed'),
    "policy_version" = 'route-quality-v1',
    "moderated_at" = CURRENT_TIMESTAMP,
    "moderation_locked" = true
WHERE CARDINALITY("starter_disciplines") > 0;

ALTER TABLE "ascent_ledger"."route_source_records"
  ADD COLUMN "publication_state" "ascent_ledger"."RoutePublicationState" NOT NULL DEFAULT 'pending_review',
  ADD COLUMN "verification_status" "ascent_ledger"."RouteVerificationStatus" NOT NULL DEFAULT 'unverified',
  ADD COLUMN "decision_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "quality_score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quality_signals_json" JSONB,
  ADD COLUMN "source_authority" TEXT,
  ADD COLUMN "policy_version" TEXT,
  ADD COLUMN "input_fingerprint" TEXT,
  ADD COLUMN "evaluated_at" TIMESTAMP(3),
  ALTER COLUMN "route_id" DROP NOT NULL;

ALTER TABLE "ascent_ledger"."route_source_records"
  DROP CONSTRAINT "route_source_records_route_id_fkey",
  ADD CONSTRAINT "route_source_records_route_id_fkey"
    FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "route_source_records_quality_score_check" CHECK ("quality_score" BETWEEN 0 AND 100);

UPDATE "ascent_ledger"."route_source_records" sr
SET "publication_state" = r."publication_state",
    "verification_status" = r."verification_status",
    "decision_reasons" = ARRAY[COALESCE(r."moderation_reason", 'Awaiting policy reclassification')],
    "quality_score" = r."quality_score",
    "source_authority" = r."source_authority",
    "policy_version" = r."policy_version",
    "evaluated_at" = r."moderated_at"
FROM "ascent_ledger"."routes" r
WHERE r."id" = sr."route_id";

CREATE INDEX "route_source_records_publication_state_source_idx"
  ON "ascent_ledger"."route_source_records"("publication_state", "source");

ALTER TABLE "ascent_ledger"."route_import_logs"
  ADD COLUMN "routes_accepted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "routes_quarantined" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "routes_rejected" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ascent_ledger"."route_moderation_events" (
  "id" UUID NOT NULL,
  "route_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" "ascent_ledger"."ModerationAction" NOT NULL,
  "from_state" "ascent_ledger"."RoutePublicationState",
  "to_state" "ascent_ledger"."RoutePublicationState" NOT NULL,
  "reason" TEXT NOT NULL,
  "policy_version" TEXT,
  "quality_score" INTEGER,
  "signals_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "route_moderation_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "route_moderation_events_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "route_moderation_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "ascent_ledger"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "route_moderation_events_quality_score_check" CHECK ("quality_score" IS NULL OR "quality_score" BETWEEN 0 AND 100)
);
CREATE INDEX "route_moderation_events_route_id_created_at_idx" ON "ascent_ledger"."route_moderation_events"("route_id", "created_at");
CREATE INDEX "route_moderation_events_to_state_created_at_idx" ON "ascent_ledger"."route_moderation_events"("to_state", "created_at");

CREATE TABLE "ascent_ledger"."custom_trails" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "discipline" "ascent_ledger"."Discipline" NOT NULL,
  "grade_system" "ascent_ledger"."GradeSystem",
  "grade_raw" TEXT,
  "grade_normalised_score" INTEGER,
  "area_name" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "path_geojson" JSONB,
  "path_source" "ascent_ledger"."PathSource",
  "length_m" INTEGER,
  "ascent_m" INTEGER,
  "estimated_duration_mins" INTEGER,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "custom_trails_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_trails_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "ascent_ledger"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "custom_trails_length_m_check" CHECK ("length_m" IS NULL OR "length_m" >= 0),
  CONSTRAINT "custom_trails_ascent_m_check" CHECK ("ascent_m" IS NULL OR "ascent_m" >= 0),
  CONSTRAINT "custom_trails_duration_check" CHECK ("estimated_duration_mins" IS NULL OR "estimated_duration_mins" > 0)
);
CREATE INDEX "custom_trails_owner_id_updated_at_idx" ON "ascent_ledger"."custom_trails"("owner_id", "updated_at");
CREATE INDEX "custom_trails_owner_id_name_idx" ON "ascent_ledger"."custom_trails"("owner_id", "name");

ALTER TABLE "ascent_ledger"."climbs" ADD COLUMN "custom_trail_id" UUID;
ALTER TABLE "ascent_ledger"."climbs"
  ADD CONSTRAINT "climbs_custom_trail_id_fkey" FOREIGN KEY ("custom_trail_id") REFERENCES "ascent_ledger"."custom_trails"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "climbs_one_route_link_check" CHECK (NOT ("route_id" IS NOT NULL AND "custom_trail_id" IS NOT NULL)),
  ADD CONSTRAINT "climbs_custom_trail_private_check" CHECK ("custom_trail_id" IS NULL OR "visibility" = 'private');
CREATE INDEX "climbs_custom_trail_id_idx" ON "ascent_ledger"."climbs"("custom_trail_id");

-- A service role may bypass RLS, so application queries still validate owner_id.
-- Direct Supabase clients get a second, database-level ownership boundary.
ALTER TABLE "ascent_ledger"."custom_trails" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custom_trails_owner_select" ON "ascent_ledger"."custom_trails"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "custom_trails_owner_insert" ON "ascent_ledger"."custom_trails"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY "custom_trails_owner_update" ON "ascent_ledger"."custom_trails"
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = owner_id) WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY "custom_trails_owner_delete" ON "ascent_ledger"."custom_trails"
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = owner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON "ascent_ledger"."custom_trails" TO authenticated;
REVOKE ALL ON "ascent_ledger"."custom_trails" FROM anon;

CREATE FUNCTION "ascent_ledger"."enforce_custom_trail_climb_owner"()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = "ascent_ledger", public AS $$
BEGIN
  IF NEW."custom_trail_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ascent_ledger"."custom_trails" t
    WHERE t."id" = NEW."custom_trail_id" AND t."owner_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'custom trail must belong to climb owner';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "climbs_custom_trail_owner_trigger"
BEFORE INSERT OR UPDATE OF "custom_trail_id", "user_id" ON "ascent_ledger"."climbs"
FOR EACH ROW EXECUTE FUNCTION "ascent_ledger"."enforce_custom_trail_climb_owner"();

-- Supabase route reads expose only approved canonical imports. Prisma uses a
-- deliberately trusted server role, so every server query also uses the DAL predicate.
ALTER TABLE "ascent_ledger"."routes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "routes_approved_public_read" ON "ascent_ledger"."routes"
  FOR SELECT TO anon, authenticated
  USING ("origin" = 'imported' AND "publication_state" = 'approved' AND "verification_status" = 'verified');
GRANT SELECT ON "ascent_ledger"."routes" TO anon, authenticated;

DROP POLICY IF EXISTS "reviews_public_read" ON "ascent_ledger"."route_reviews";
CREATE POLICY "reviews_approved_routes_read" ON "ascent_ledger"."route_reviews"
  FOR SELECT TO anon, authenticated USING (EXISTS (
    SELECT 1 FROM "ascent_ledger"."routes" r
    WHERE r."id" = route_id AND r."origin" = 'imported'
      AND r."publication_state" = 'approved' AND r."verification_status" = 'verified'
  ));

DROP POLICY IF EXISTS "reviews_owner_insert" ON "ascent_ledger"."route_reviews";
CREATE POLICY "reviews_owner_insert" ON "ascent_ledger"."route_reviews"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (
    SELECT 1 FROM "ascent_ledger"."routes" r WHERE r."id" = route_id
      AND r."origin" = 'imported' AND r."publication_state" = 'approved' AND r."verification_status" = 'verified'
  ));
DROP POLICY IF EXISTS "reviews_owner_update" ON "ascent_ledger"."route_reviews";
CREATE POLICY "reviews_owner_update" ON "ascent_ledger"."route_reviews"
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (
    SELECT 1 FROM "ascent_ledger"."routes" r WHERE r."id" = route_id
      AND r."origin" = 'imported' AND r."publication_state" = 'approved' AND r."verification_status" = 'verified'
  ));

DROP POLICY IF EXISTS "route_tags_owner_insert" ON "ascent_ledger"."route_tags";
CREATE POLICY "route_tags_owner_insert" ON "ascent_ledger"."route_tags"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (
    SELECT 1 FROM "ascent_ledger"."routes" r WHERE r."id" = route_id
      AND r."origin" = 'imported' AND r."publication_state" = 'approved' AND r."verification_status" = 'verified'
  ));

DROP POLICY IF EXISTS "saved_routes_owner_all" ON "ascent_ledger"."saved_routes";
CREATE POLICY "saved_routes_owner_select" ON "ascent_ledger"."saved_routes"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "saved_routes_owner_insert" ON "ascent_ledger"."saved_routes"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (
    SELECT 1 FROM "ascent_ledger"."routes" r WHERE r."id" = route_id
      AND r."origin" = 'imported' AND r."publication_state" = 'approved' AND r."verification_status" = 'verified'
  ));
CREATE POLICY "saved_routes_owner_delete" ON "ascent_ledger"."saved_routes"
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE VIEW "ascent_ledger"."public_ticks" WITH (security_barrier = true) AS
SELECT
  c.id, c.route_id,
  COALESCE(NULLIF(u.display_name, ''), 'Ascent Ledger member') AS display_name,
  r.name AS route_name, c.date, c.grade_raw AS grade, c.ascent_style
FROM "ascent_ledger"."climbs" c
JOIN "ascent_ledger"."users" u ON u.id = c.user_id
JOIN "ascent_ledger"."routes" r ON r.id = c.route_id
WHERE c.visibility = 'public'
  AND r.origin = 'imported'
  AND r.publication_state = 'approved'
  AND r.verification_status = 'verified';

CREATE OR REPLACE VIEW "ascent_ledger"."route_tag_counts" WITH (security_barrier = true) AS
SELECT rt.route_id, rt.tag_id, COUNT(*)::INTEGER AS count
FROM "ascent_ledger"."route_tags" rt
JOIN "ascent_ledger"."routes" r ON r.id = rt.route_id
WHERE r.origin = 'imported'
  AND r.publication_state = 'approved'
  AND r.verification_status = 'verified'
GROUP BY rt.route_id, rt.tag_id;

-- Audit/moderation data is intentionally server/service-role only.
REVOKE ALL ON "ascent_ledger"."route_source_records" FROM anon, authenticated;
REVOKE ALL ON "ascent_ledger"."route_moderation_events" FROM anon, authenticated;
