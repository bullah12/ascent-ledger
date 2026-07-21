-- Functional metadata and saved-route support for the topographic experience.
ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN "ascent_m" INTEGER,
  ADD COLUMN "estimated_duration_mins" INTEGER;

ALTER TABLE "ascent_ledger"."climbs"
  ADD COLUMN "ascent_m" INTEGER,
  ADD COLUMN "duration_minutes" INTEGER,
  ADD COLUMN "variant" TEXT,
  ADD COLUMN "conditions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "rating" INTEGER;

ALTER TABLE "ascent_ledger"."route_reviews"
  ADD COLUMN "variant" TEXT,
  ADD COLUMN "conditions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ascent_ledger"."routes"
  ADD CONSTRAINT "routes_ascent_m_check" CHECK ("ascent_m" IS NULL OR "ascent_m" >= 0),
  ADD CONSTRAINT "routes_estimated_duration_mins_check" CHECK ("estimated_duration_mins" IS NULL OR "estimated_duration_mins" > 0);

ALTER TABLE "ascent_ledger"."climbs"
  ADD CONSTRAINT "climbs_ascent_m_check" CHECK ("ascent_m" IS NULL OR "ascent_m" >= 0),
  ADD CONSTRAINT "climbs_duration_minutes_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0),
  ADD CONSTRAINT "climbs_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);

CREATE TABLE "ascent_ledger"."saved_routes" (
  "user_id" UUID NOT NULL,
  "route_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_routes_pkey" PRIMARY KEY ("user_id", "route_id"),
  CONSTRAINT "saved_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ascent_ledger"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "saved_routes_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "ascent_ledger"."routes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "saved_routes_route_id_idx" ON "ascent_ledger"."saved_routes"("route_id");

ALTER TABLE "ascent_ledger"."saved_routes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_routes_owner_all" ON "ascent_ledger"."saved_routes"
  FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, DELETE ON "ascent_ledger"."saved_routes" TO authenticated;
