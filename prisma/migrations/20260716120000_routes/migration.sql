CREATE SCHEMA IF NOT EXISTS "ascent_ledger";
SET search_path = "ascent_ledger", public;

-- AlterTable
ALTER TABLE "climbs" ADD COLUMN     "route_id" UUID;

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "area_id" UUID,
    "discipline" "Discipline" NOT NULL,
    "grade_system" "GradeSystem",
    "grade_raw" TEXT,
    "grade_normalised_score" INTEGER,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "length_m" INTEGER,
    "pitches" INTEGER,
    "description" TEXT,
    "quality_rating" INTEGER,
    "external_source" TEXT,
    "external_url" TEXT,
    "external_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_import_logs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "routes_added" INTEGER NOT NULL DEFAULT 0,
    "routes_updated" INTEGER NOT NULL DEFAULT 0,
    "errors_json" JSONB,

    CONSTRAINT "route_import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routes_name_idx" ON "routes"("name");

-- CreateIndex
CREATE INDEX "routes_external_source_external_id_idx" ON "routes"("external_source", "external_id");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "climbs" ADD CONSTRAINT "climbs_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
