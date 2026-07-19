CREATE SCHEMA IF NOT EXISTS "ascent_ledger";
SET search_path = "ascent_ledger", public;

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- DropIndex
DROP INDEX "routes_external_source_external_id_idx";

-- CreateTable
CREATE TABLE "climb_route_suggestions" (
    "id" UUID NOT NULL,
    "climb_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "climb_route_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "climb_route_suggestions_status_idx" ON "climb_route_suggestions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "climb_route_suggestions_climb_id_route_id_key" ON "climb_route_suggestions"("climb_id", "route_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_external_source_external_id_key" ON "routes"("external_source", "external_id");

-- AddForeignKey
ALTER TABLE "climb_route_suggestions" ADD CONSTRAINT "climb_route_suggestions_climb_id_fkey" FOREIGN KEY ("climb_id") REFERENCES "climbs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "climb_route_suggestions" ADD CONSTRAINT "climb_route_suggestions_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
