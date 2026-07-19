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
