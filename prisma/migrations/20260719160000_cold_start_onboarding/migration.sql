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
