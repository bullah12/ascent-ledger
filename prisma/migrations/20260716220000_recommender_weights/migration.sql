CREATE SCHEMA IF NOT EXISTS "ascent_ledger";
SET search_path = "ascent_ledger", public;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recommender_weights_json" JSONB;
