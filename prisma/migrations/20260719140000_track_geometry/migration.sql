-- Phase 8: render-ready trail geometry for canonical routes and personal climbs.
CREATE TYPE "ascent_ledger"."PathSource" AS ENUM (
  'drawn',
  'gpx_upload',
  'kml_upload',
  'import'
);

ALTER TABLE "ascent_ledger"."routes"
  ADD COLUMN "path_geojson" JSONB,
  ADD COLUMN "path_source" "ascent_ledger"."PathSource";

ALTER TABLE "ascent_ledger"."climbs"
  ADD COLUMN "path_geojson" JSONB,
  ADD COLUMN "path_source" "ascent_ledger"."PathSource";
