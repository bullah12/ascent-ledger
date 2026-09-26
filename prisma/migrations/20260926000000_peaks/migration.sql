CREATE TABLE "ascent_ledger"."peaks" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "elevation_m" INTEGER,
    "summary" TEXT,
    "image_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "peaks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "peaks_slug_key" ON "ascent_ledger"."peaks"("slug");
CREATE INDEX "peaks_name_idx" ON "ascent_ledger"."peaks"("name");

ALTER TABLE "ascent_ledger"."routes" ADD COLUMN "peak_id" UUID;
CREATE INDEX "routes_peak_id_idx" ON "ascent_ledger"."routes"("peak_id");
ALTER TABLE "ascent_ledger"."routes" ADD CONSTRAINT "routes_peak_id_fkey"
  FOREIGN KEY ("peak_id") REFERENCES "ascent_ledger"."peaks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
