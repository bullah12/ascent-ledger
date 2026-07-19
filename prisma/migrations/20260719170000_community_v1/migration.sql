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
  RETURN COALESCE(NEW, OLD);
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
