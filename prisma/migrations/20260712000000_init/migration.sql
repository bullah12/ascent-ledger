-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ascent_ledger";
SET search_path = "ascent_ledger", public;

-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('rock', 'winter', 'alpine', 'ski_touring');

-- CreateEnum
CREATE TYPE "GradeSystem" AS ENUM ('uk_trad', 'french_sport', 'uiaa', 'scottish_winter', 'wi_ice', 'alpine_overall', 'ski_touring_scale');

-- CreateEnum
CREATE TYPE "AscentStyle" AS ENUM ('led', 'alternate_lead', 'seconded', 'solo', 'roped_solo');

-- CreateEnum
CREATE TYPE "ClimbSource" AS ENUM ('manual', 'csv_import', 'ukc_import');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "home_region" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "discipline_tags" "Discipline"[],

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "climbs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "free_text_route_name" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "date" DATE NOT NULL,
    "grade_system" "GradeSystem",
    "grade_raw" TEXT NOT NULL,
    "grade_normalised_score" INTEGER,
    "ascent_style" "AscentStyle" NOT NULL,
    "pitches" INTEGER,
    "length_m" INTEGER,
    "area_id" UUID,
    "partners" TEXT[],
    "notes" TEXT,
    "photo_urls" TEXT[],
    "gpx_track_url" TEXT,
    "source" "ClimbSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "climbs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "areas_name_key" ON "areas"("name");

-- CreateIndex
CREATE INDEX "climbs_user_id_date_idx" ON "climbs"("user_id", "date");

-- AddForeignKey
ALTER TABLE "climbs" ADD CONSTRAINT "climbs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "climbs" ADD CONSTRAINT "climbs_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

