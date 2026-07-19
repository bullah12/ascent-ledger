-- Ascent Ledger Phases 9–12: manual Supabase migration and seeds
-- Generated from the committed forward migrations and audited seed fixtures.
-- Prerequisite: an existing database migrated through Phase 8
-- (20260719140000_track_geometry).
-- Run this entire file once in the Supabase SQL editor.

DO $$
BEGIN
  IF to_regclass('ascent_ledger.users') IS NULL
     OR to_regclass('ascent_ledger.routes') IS NULL
     OR to_regclass('ascent_ledger.climbs') IS NULL THEN
    RAISE EXCEPTION 'Phase 8 schema not found: users, routes, and climbs are required';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Phase 9 — hiking ingestion
-- -----------------------------------------------------------------------------
BEGIN;
-- Phase 9: hiking logbook/import support and the SAC hiking grade system.
-- Enum additions are forward-only; existing rows and BMG categories are unchanged.
ALTER TYPE "ascent_ledger"."Discipline" ADD VALUE IF NOT EXISTS 'hiking';
ALTER TYPE "ascent_ledger"."GradeSystem" ADD VALUE IF NOT EXISTS 'sac_hiking';
COMMIT;

-- -----------------------------------------------------------------------------
-- Phase 10 — onboarding
-- -----------------------------------------------------------------------------
BEGIN;
-- Phase 10: minimal onboarding preferences and auditable starter-route flags.
CREATE TABLE "ascent_ledger"."user_preferences" (
  "user_id" UUID NOT NULL,
  "preferred_disciplines" "ascent_ledger"."Discipline"[] NOT NULL,
  "home_region" TEXT,
  "provisional_grades_json" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "ascent_ledger"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Existing users predate onboarding and must not be trapped in a first-login
-- redirect. Their existing home region is retained; no provisional history is invented.
INSERT INTO "ascent_ledger"."user_preferences"
  ("user_id", "preferred_disciplines", "home_region", "updated_at")
SELECT "id", ARRAY[]::"ascent_ledger"."Discipline"[], "home_region", CURRENT_TIMESTAMP
FROM "ascent_ledger"."users"
ON CONFLICT ("user_id") DO NOTHING;

ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN "starter_disciplines" "ascent_ledger"."Discipline"[] NOT NULL
  DEFAULT ARRAY[]::"ascent_ledger"."Discipline"[];
COMMIT;

-- -----------------------------------------------------------------------------
-- Phase 11 — community and RLS
-- -----------------------------------------------------------------------------
BEGIN;
-- Phase 11: route-centric community data and private-by-default public ticks.
CREATE TYPE "ascent_ledger"."ClimbVisibility" AS ENUM ('private', 'public');
CREATE TYPE "ascent_ledger"."TagKind" AS ENUM ('terrain', 'character', 'hazard', 'logistics');

ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN "review_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "avg_rating" DOUBLE PRECISION;

ALTER TABLE "ascent_ledger"."climbs"
  ADD COLUMN "visibility" "ascent_ledger"."ClimbVisibility" NOT NULL DEFAULT 'private';

CREATE TABLE "ascent_ledger"."route_reviews" (
  "id" UUID NOT NULL,
  "route_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "text" TEXT,
  "climbed_on" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "route_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "route_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "route_reviews_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "route_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ascent_ledger"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ascent_ledger"."tags" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" "ascent_ledger"."TagKind" NOT NULL,
  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ascent_ledger"."route_tags" (
  "route_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "route_tags_pkey" PRIMARY KEY ("route_id", "tag_id", "user_id"),
  CONSTRAINT "route_tags_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "route_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "ascent_ledger"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "route_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ascent_ledger"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "route_reviews_route_id_user_id_key" ON "ascent_ledger"."route_reviews"("route_id", "user_id");
CREATE INDEX "route_reviews_route_id_updated_at_idx" ON "ascent_ledger"."route_reviews"("route_id", "updated_at");
CREATE UNIQUE INDEX "tags_slug_key" ON "ascent_ledger"."tags"("slug");
CREATE INDEX "tags_kind_label_idx" ON "ascent_ledger"."tags"("kind", "label");
CREATE INDEX "route_tags_route_id_tag_id_idx" ON "ascent_ledger"."route_tags"("route_id", "tag_id");

-- Atomic row updates keep cached review aggregates correct even for writes
-- made through Supabase rather than the application server actions.
CREATE FUNCTION "ascent_ledger"."update_route_review_aggregates"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = "ascent_ledger", public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "ascent_ledger"."routes"
    SET "avg_rating" = ((COALESCE("avg_rating", 0) * "review_count") + NEW."rating") / ("review_count" + 1),
        "review_count" = "review_count" + 1
    WHERE "id" = NEW."route_id";
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."route_id" = OLD."route_id" THEN
      UPDATE "ascent_ledger"."routes"
      SET "avg_rating" = "avg_rating" + ((NEW."rating" - OLD."rating")::DOUBLE PRECISION / NULLIF("review_count", 0))
      WHERE "id" = NEW."route_id";
    ELSE
      UPDATE "ascent_ledger"."routes"
      SET "avg_rating" = CASE
            WHEN "review_count" <= 1 THEN NULL
            ELSE (("avg_rating" * "review_count") - OLD."rating") / ("review_count" - 1)
          END,
          "review_count" = GREATEST("review_count" - 1, 0)
      WHERE "id" = OLD."route_id";
      UPDATE "ascent_ledger"."routes"
      SET "avg_rating" = ((COALESCE("avg_rating", 0) * "review_count") + NEW."rating") / ("review_count" + 1),
          "review_count" = "review_count" + 1
      WHERE "id" = NEW."route_id";
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "ascent_ledger"."routes"
    SET "avg_rating" = CASE
          WHEN "review_count" <= 1 THEN NULL
          ELSE (("avg_rating" * "review_count") - OLD."rating") / ("review_count" - 1)
        END,
        "review_count" = GREATEST("review_count" - 1, 0)
    WHERE "id" = OLD."route_id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "route_reviews_aggregate_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "ascent_ledger"."route_reviews"
FOR EACH ROW EXECUTE FUNCTION "ascent_ledger"."update_route_review_aggregates"();

-- Prisma uses a trusted server role; Supabase clients are constrained here.
ALTER TABLE "ascent_ledger"."climbs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ascent_ledger"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ascent_ledger"."user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ascent_ledger"."route_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ascent_ledger"."route_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ascent_ledger"."tags" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "climbs_owner_select" ON "ascent_ledger"."climbs"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "climbs_owner_insert" ON "ascent_ledger"."climbs"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "climbs_owner_update" ON "ascent_ledger"."climbs"
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "climbs_owner_delete" ON "ascent_ledger"."climbs"
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users_owner_select" ON "ascent_ledger"."users"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY "users_owner_update" ON "ascent_ledger"."users"
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY "preferences_owner_all" ON "ascent_ledger"."user_preferences"
  FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "reviews_public_read" ON "ascent_ledger"."route_reviews"
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "reviews_owner_insert" ON "ascent_ledger"."route_reviews"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reviews_owner_update" ON "ascent_ledger"."route_reviews"
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reviews_owner_delete" ON "ascent_ledger"."route_reviews"
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "tags_public_read" ON "ascent_ledger"."tags"
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "route_tags_owner_select" ON "ascent_ledger"."route_tags"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "route_tags_owner_insert" ON "ascent_ledger"."route_tags"
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "route_tags_owner_delete" ON "ascent_ledger"."route_tags"
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Public ticks are a column-safe projection. The underlying climbs table has
-- no public SELECT policy, so notes, partners, photos, raw tracks, geometry,
-- preferences, emails, and other logbook columns cannot be selected publicly.
CREATE VIEW "ascent_ledger"."public_ticks" WITH (security_barrier = true) AS
SELECT
  c.id,
  c.route_id,
  COALESCE(NULLIF(u.display_name, ''), 'Ascent Ledger member') AS display_name,
  COALESCE(r.name, c.free_text_route_name) AS route_name,
  c.date,
  c.grade_raw AS grade,
  c.ascent_style
FROM "ascent_ledger"."climbs" c
JOIN "ascent_ledger"."users" u ON u.id = c.user_id
LEFT JOIN "ascent_ledger"."routes" r ON r.id = c.route_id
WHERE c.visibility = 'public' AND c.route_id IS NOT NULL;

CREATE VIEW "ascent_ledger"."route_tag_counts" WITH (security_barrier = true) AS
SELECT rt.route_id, rt.tag_id, COUNT(*)::INTEGER AS count
FROM "ascent_ledger"."route_tags" rt
GROUP BY rt.route_id, rt.tag_id;

REVOKE ALL ON "ascent_ledger"."climbs" FROM anon;
REVOKE ALL ON "ascent_ledger"."users" FROM anon;
REVOKE ALL ON "ascent_ledger"."user_preferences" FROM anon;
REVOKE ALL ON "ascent_ledger"."route_tags" FROM anon;
GRANT USAGE ON SCHEMA "ascent_ledger" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ascent_ledger"."climbs" TO authenticated;
GRANT SELECT, UPDATE ON "ascent_ledger"."users" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ascent_ledger"."user_preferences" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ascent_ledger"."route_reviews" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "ascent_ledger"."route_tags" TO authenticated;
GRANT SELECT ON "ascent_ledger"."public_ticks" TO anon, authenticated;
GRANT SELECT ON "ascent_ledger"."route_tag_counts" TO anon, authenticated;
GRANT SELECT ON "ascent_ledger"."route_reviews" TO anon, authenticated;
GRANT SELECT ON "ascent_ledger"."tags" TO anon, authenticated;
COMMIT;

-- -----------------------------------------------------------------------------
-- Phase 12 — preference suggestions
-- -----------------------------------------------------------------------------
BEGIN;
-- Phase 12: explicit preferences and weights for the general suggestion engine.
ALTER TABLE "ascent_ledger"."user_preferences"
  ADD COLUMN "grade_windows_json" JSONB,
  ADD COLUMN "preferred_regions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "preferred_tag_slugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "max_trip_length_days" INTEGER,
  ADD COLUMN "suggestion_weights_json" JSONB,
  ADD COLUMN "explore_level" DOUBLE PRECISION NOT NULL DEFAULT 0.35;

ALTER TABLE "ascent_ledger"."user_preferences"
  ADD CONSTRAINT "user_preferences_max_trip_length_days_check"
    CHECK ("max_trip_length_days" IS NULL OR "max_trip_length_days" > 0),
  ADD CONSTRAINT "user_preferences_explore_level_check"
    CHECK ("explore_level" BETWEEN 0 AND 1);
COMMIT;

-- -----------------------------------------------------------------------------
-- Curated community tags (idempotent)
-- -----------------------------------------------------------------------------
BEGIN;
INSERT INTO "ascent_ledger"."tags" ("id", "slug", "label", "kind")
VALUES
  (gen_random_uuid(), 'slab', 'Slab', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'crack', 'Crack', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'ridge', 'Ridge', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'gully', 'Gully', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'icefall', 'Icefall', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'mixed', 'Mixed', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'glacier', 'Glacier', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'scree', 'Scree', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'woodland', 'Woodland', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'coastal', 'Coastal', 'terrain'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'sustained', 'Sustained', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'technical', 'Technical', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'exposed', 'Exposed', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'remote', 'Remote', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'scenic', 'Scenic', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'beginner-friendly', 'Beginner friendly', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'committing', 'Committing', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'pumpy', 'Pumpy', 'character'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'avalanche', 'Avalanche terrain', 'hazard'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'rockfall', 'Rockfall', 'hazard'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'crevasses', 'Crevasses', 'hazard'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'loose-rock', 'Loose rock', 'hazard'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'tidal', 'Tidal', 'hazard'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'river-crossing', 'River crossing', 'hazard'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'public-transport', 'Public transport', 'logistics'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'camping', 'Camping nearby', 'logistics'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'refuge', 'Refuge', 'logistics'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'permit-required', 'Permit required', 'logistics'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'seasonal-access', 'Seasonal access', 'logistics'::"ascent_ledger"."TagKind"),
  (gen_random_uuid(), 'dog-friendly', 'Dog friendly', 'logistics'::"ascent_ledger"."TagKind")
ON CONFLICT ("slug") DO UPDATE
SET "label" = EXCLUDED."label", "kind" = EXCLUDED."kind";
COMMIT;

-- -----------------------------------------------------------------------------
-- Audited starter routes (idempotent)
-- -----------------------------------------------------------------------------
BEGIN;
WITH "_ascent_ledger_starter_routes" AS MATERIALIZED (
SELECT *
FROM jsonb_to_recordset($starter_routes$
[
  {
    "source": "national_trails_england",
    "external_id": "1",
    "name": "Pennine Way",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 53.3704600431356,
    "lng": -1.81681175592665,
    "length_m": 435000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "2",
    "name": "Offa's Dyke Path",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 51.6325461883951,
    "lng": -2.6484311666258,
    "length_m": 292000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "3",
    "name": "South Downs Way",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 50.9955839736578,
    "lng": -1.14310285852966,
    "length_m": 183000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "4",
    "name": "The Ridgeway",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 51.8421372378442,
    "lng": -0.608369023483769,
    "length_m": 139000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "5",
    "name": "North Downs Way",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 51.1243092826377,
    "lng": 1.31377491238465,
    "length_m": 256000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "6",
    "name": "Yorkshire Wolds Way",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 53.7173240569164,
    "lng": -0.434647027150166,
    "length_m": 131000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "7",
    "name": "Peddars Way and Norfolk Coast Path",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 52.3905621629651,
    "lng": 0.85487037459923,
    "length_m": 149000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "8",
    "name": "Thames Path",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 51.3873754067336,
    "lng": -0.4305328336919,
    "length_m": 344000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "9",
    "name": "Hadrian's Wall Path",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 54.9541355857573,
    "lng": -3.21164700081032,
    "length_m": 138000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "national_trails_england",
    "external_id": "10",
    "name": "Cotswold Way",
    "discipline": "hiking",
    "grade_system": null,
    "grade": null,
    "lat": 51.3811856124404,
    "lng": -2.35885532137663,
    "length_m": 171000,
    "quality": null,
    "area": "National Trails — England",
    "region": "England",
    "country": "United Kingdom"
  },
  {
    "source": "camptocamp",
    "external_id": "1928107",
    "name": "Vas-y Guigui",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "4c",
    "lat": 46.2794,
    "lng": 7.3961,
    "length_m": null,
    "quality": 2,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1928283",
    "name": "À visage découvert",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "5c+",
    "lat": 44.88132,
    "lng": 6.44545,
    "length_m": null,
    "quality": 3,
    "area": "Écrins",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1927818",
    "name": "Les amélanchiers",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "6a",
    "lat": 44.713871,
    "lng": 6.576372,
    "length_m": null,
    "quality": 4,
    "area": "Écrins",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1928663",
    "name": "Narvalaux",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "5a",
    "lat": 45.23792416,
    "lng": 6.08633987,
    "length_m": null,
    "quality": 4,
    "area": "Belledonne",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1924771",
    "name": "De rides en poils",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "5b",
    "lat": 44.551114,
    "lng": 6.772449,
    "length_m": null,
    "quality": 4,
    "area": "Queyras S - Parpaillon - Ubaye - Orrenaye",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1924327",
    "name": "Les Perséides",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "6a+",
    "lat": 45.99905089,
    "lng": 7.49723428,
    "length_m": null,
    "quality": 5,
    "area": "Valais W - Pennine Alps W",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1920096",
    "name": "Platten - Sylia",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "6a",
    "lat": 46.730885,
    "lng": 8.427687,
    "length_m": null,
    "quality": 4,
    "area": "Alpes Uranaises",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1918799",
    "name": "Pointe NW 2865 - Far away from Etienne's",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "5c+",
    "lat": 44.89177084,
    "lng": 6.45503608,
    "length_m": null,
    "quality": 4,
    "area": "Écrins",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1918157",
    "name": "Les années 40",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "6a",
    "lat": 43.750815,
    "lng": 7.137478,
    "length_m": null,
    "quality": 4,
    "area": "Pelat - Préalpes de Castellane - Estérel",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1913484",
    "name": "Scudo di Marte",
    "discipline": "rock",
    "grade_system": "french_sport",
    "grade": "6a",
    "lat": 44.85775161,
    "lng": 7.17564763,
    "length_m": null,
    "quality": 4,
    "area": "Cottian Alps - N Queyras - Briançonnais",
    "region": "Alps",
    "country": "Italy"
  },
  {
    "source": "camptocamp",
    "external_id": "1928108",
    "name": "Traversées arête SW - arête ESE",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD",
    "lat": 45.9575901087363,
    "lng": 7.04685056581664,
    "length_m": null,
    "quality": 3,
    "area": "Mont-Blanc",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1928323",
    "name": "Arête W",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD+",
    "lat": 44.2675042991768,
    "lng": 6.95380053513301,
    "length_m": null,
    "quality": 4,
    "area": "Mercantour - Argentera",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1927969",
    "name": "Par l'arête NE",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD",
    "lat": 46.303895,
    "lng": 7.1891,
    "length_m": null,
    "quality": 4,
    "area": "Vaudois Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1926439",
    "name": "Traversée intégrale des crêtes du Bättlihorn de Grengiols à Rosswald",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "F+",
    "lat": 46.336758,
    "lng": 8.093685,
    "length_m": null,
    "quality": 5,
    "area": "Ticino Alps - Goms",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1925802",
    "name": "Versant W - Voie Coolidge",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD+",
    "lat": 44.89723,
    "lng": 6.28002,
    "length_m": null,
    "quality": 4,
    "area": "Écrins",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1925293",
    "name": "Traversée W > E intégrale du Mont Pelve",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD+",
    "lat": 45.357543,
    "lng": 6.765068,
    "length_m": null,
    "quality": 5,
    "area": "Vanoise",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1924536",
    "name": "Arête NE",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "AD+",
    "lat": 44.368307,
    "lng": 6.524815,
    "length_m": null,
    "quality": 4,
    "area": "Préalpes de Digne",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1921745",
    "name": "Traversée NE > NW du Pic de la Grave",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD+",
    "lat": 44.99519,
    "lng": 6.2542,
    "length_m": null,
    "quality": 5,
    "area": "Écrins",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1917466",
    "name": "Traversée par l’arête NW",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD+",
    "lat": 46.5545282,
    "lng": 8.00688219,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1910563",
    "name": "La sève ou Arête SW du Caire fourchu",
    "discipline": "alpine",
    "grade_system": "alpine_overall",
    "grade": "PD+",
    "lat": 44.1175,
    "lng": 7.23,
    "length_m": null,
    "quality": 4,
    "area": "Mercantour - Argentera",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1891046",
    "name": "Cascade à JaBo",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4+",
    "lat": 45.9645553878955,
    "lng": 7.31092245398751,
    "length_m": null,
    "quality": 4,
    "area": "Valais W - Pennine Alps W",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1887565",
    "name": "Cascade de la Gurre du Bois",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4",
    "lat": 45.464888565235,
    "lng": 6.74374622309503,
    "length_m": null,
    "quality": 2,
    "area": "Vanoise",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1887548",
    "name": "Cascade du cul du nant",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4+",
    "lat": 45.477456628196,
    "lng": 6.79378088118867,
    "length_m": null,
    "quality": 2,
    "area": "Vanoise",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1874569",
    "name": "Cascades de Glace du Requin - La Bleue",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4+",
    "lat": 45.88395781,
    "lng": 6.93055747,
    "length_m": null,
    "quality": 4,
    "area": "Mont-Blanc",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1871044",
    "name": "Namenlos - Kleine Schlucht",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4+",
    "lat": 46.49337757,
    "lng": 7.73604438,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1869568",
    "name": "Voies de mixte de la cascade du milieu",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4",
    "lat": 45.9936,
    "lng": 6.51819,
    "length_m": null,
    "quality": 4,
    "area": "Bornes - Aravis",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1869491",
    "name": "Black Dry [Dry-tooling]",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "2",
    "lat": 44.24194465,
    "lng": 6.88673274,
    "length_m": null,
    "quality": 4,
    "area": "Mercantour - Argentera",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1864785",
    "name": "Allmenalpfall",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4+",
    "lat": 46.4936,
    "lng": 7.6504,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1862669",
    "name": "Cascade de Valdobbia",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "3+",
    "lat": 45.77493492,
    "lng": 7.83080643,
    "length_m": null,
    "quality": 5,
    "area": "Valais E - Pennine Alps E",
    "region": "Alps",
    "country": "Italy"
  },
  {
    "source": "camptocamp",
    "external_id": "1855218",
    "name": "Deuxième étage",
    "discipline": "winter",
    "grade_system": "wi_ice",
    "grade": "4",
    "lat": 44.9249308,
    "lng": 6.24590986,
    "length_m": null,
    "quality": 4,
    "area": "Écrins",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1920411",
    "name": "Descent to Münster via Blaggibärg and Minstigertal",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD-",
    "lat": 46.516099,
    "lng": 8.188871,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1909649",
    "name": "Raids de l'Oberland vers. B: de Münster VS à Rosenlaui Gletscherschlucht",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD+",
    "lat": 46.5439133428028,
    "lng": 8.19024348866399,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1907217",
    "name": "Anello F.la Radont m 2786>F.la Vallorgia m 2962>F.la 2981 a Est Scalettahorn>quota 2380 Chilbiritze per il Gletschtalli>F.la Grialetsch",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD",
    "lat": 46.693753,
    "lng": 9.954852,
    "length_m": null,
    "quality": 4,
    "area": "Central Graubünden Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1909123",
    "name": "Traverse from Aarbiwak to Oberaarjoch",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD+",
    "lat": 46.53959555,
    "lng": 8.17968168,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1900251",
    "name": "depuis le chalet refuge de Rosuel",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "PD+",
    "lat": 45.53104561,
    "lng": 6.84467385,
    "length_m": null,
    "quality": 4,
    "area": "Vanoise",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1894793",
    "name": "Traversata Gelten Hutte-Wildstrubel Hutte m 2789 concatenando lo Schnidehore m 2937",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "PD+",
    "lat": 46.35451,
    "lng": 7.36066,
    "length_m": null,
    "quality": 4,
    "area": "Bernese Alps",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1894724",
    "name": "Versant SE",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD-",
    "lat": 45.6850131,
    "lng": 7.05201578,
    "length_m": null,
    "quality": 4,
    "area": "Graian Alps - Charbonnel",
    "region": "Alps",
    "country": "Italy"
  },
  {
    "source": "camptocamp",
    "external_id": "1894052",
    "name": "Depuis la Florence par la source du Gargoton",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "PD",
    "lat": 45.407025,
    "lng": 6.202606,
    "length_m": null,
    "quality": 4,
    "area": "Belledonne",
    "region": "Alps",
    "country": "France"
  },
  {
    "source": "camptocamp",
    "external_id": "1890624",
    "name": "En traversée, du Simplonpass, descente sur Schallberg",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD",
    "lat": 46.262385,
    "lng": 8.020351,
    "length_m": null,
    "quality": 4,
    "area": "Valais E - Pennine Alps E",
    "region": "Alps",
    "country": "Switzerland"
  },
  {
    "source": "camptocamp",
    "external_id": "1890354",
    "name": "Bocchetta di Diei / Monte Cistella da Esigo",
    "discipline": "ski_touring",
    "grade_system": "ski_touring_scale",
    "grade": "AD",
    "lat": 46.28464734,
    "lng": 8.30040556,
    "length_m": null,
    "quality": 4,
    "area": "Ticino Alps - Goms",
    "region": "Alps",
    "country": "Italy"
  }
]
$starter_routes$::jsonb) AS route(
  "source" TEXT,
  "external_id" TEXT,
  "name" TEXT,
  "discipline" TEXT,
  "grade_system" TEXT,
  "grade" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "length_m" INTEGER,
  "quality" INTEGER,
  "area" TEXT,
  "region" TEXT,
  "country" TEXT
)
),
"_upserted_starter_areas" AS (
  INSERT INTO "ascent_ledger"."areas"
    ("id", "name", "region", "country", "discipline_tags")
  SELECT DISTINCT ON ("area")
    gen_random_uuid(), "area", "region", "country",
    ARRAY[]::"ascent_ledger"."Discipline"[]
  FROM "_ascent_ledger_starter_routes"
  WHERE TRUE
  ORDER BY "area"
  ON CONFLICT ("name") DO UPDATE
  SET "region" = EXCLUDED."region", "country" = EXCLUDED."country"
  RETURNING "id", "name"
)

INSERT INTO "ascent_ledger"."routes" (
  "id", "name", "area_id", "discipline", "grade_system", "grade_raw",
  "grade_normalised_score", "lat", "lng", "length_m", "quality_rating",
  "external_source", "external_url", "external_id", "last_synced_at",
  "starter_disciplines", "created_at", "updated_at", "review_count"
)
SELECT
  gen_random_uuid(),
  route."name",
  area."id",
  route."discipline"::"ascent_ledger"."Discipline",
  CASE WHEN route."grade_system" IS NULL THEN NULL
       ELSE route."grade_system"::"ascent_ledger"."GradeSystem" END,
  route."grade",
  CASE
    WHEN route."grade_system" = 'alpine_overall' THEN
      CASE route."grade" WHEN 'F+' THEN 2 WHEN 'PD' THEN 4 WHEN 'PD+' THEN 5 WHEN 'AD+' THEN 8 END
    WHEN route."grade_system" = 'wi_ice' THEN
      CASE route."grade" WHEN '2' THEN 2 WHEN '3+' THEN 4 WHEN '4' THEN 5 WHEN '4+' THEN 6 END
    WHEN route."grade_system" = 'ski_touring_scale' THEN
      CASE route."grade" WHEN 'PD' THEN 3 WHEN 'PD+' THEN 4 WHEN 'AD-' THEN 5 WHEN 'AD' THEN 6 WHEN 'AD+' THEN 7 END
    ELSE NULL
  END,
  route."lat",
  route."lng",
  route."length_m",
  route."quality",
  route."source",
  CASE route."source"
    WHEN 'camptocamp' THEN 'https://www.camptocamp.org/routes/' || route."external_id"
    WHEN 'national_trails_england' THEN 'https://www.data.gov.uk/dataset/ac8c851c-99a0-4488-8973-6c8863529c45/national-trails-england3'
  END,
  route."external_id",
  TIMESTAMPTZ '2026-07-19 00:00:00+00',
  ARRAY[route."discipline"::"ascent_ledger"."Discipline"],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  0
FROM "_ascent_ledger_starter_routes" route
JOIN "_upserted_starter_areas" area ON area."name" = route."area"
WHERE TRUE
ON CONFLICT ("external_source", "external_id") DO UPDATE
SET "starter_disciplines" = EXCLUDED."starter_disciplines";
COMMIT;

-- -----------------------------------------------------------------------------
-- Verification: expected result is one row with 30 tags and 50 starter routes.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM "ascent_ledger"."tags") AS total_tags,
  (SELECT COUNT(*) FROM "ascent_ledger"."routes"
   WHERE cardinality("starter_disciplines") > 0) AS total_starter_routes,
  (SELECT COUNT(*) FROM "ascent_ledger"."climbs"
   WHERE "visibility" = 'public') AS public_climbs,
  (SELECT COUNT(*) FROM "ascent_ledger"."climbs"
   WHERE "visibility" = 'private') AS private_climbs;
