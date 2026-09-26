ALTER TABLE "ascent_ledger"."peaks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "peaks_public_read" ON "ascent_ledger"."peaks"
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM "ascent_ledger"."routes" r
    WHERE r."peak_id" = "peaks"."id"
      AND r."origin" = 'imported'
      AND r."publication_state" = 'approved'
      AND r."verification_status" = 'verified'
  ));

GRANT SELECT ON "ascent_ledger"."peaks" TO anon, authenticated;
