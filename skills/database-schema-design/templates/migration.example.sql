-- 0007_add_wholesale_tiers.sql
-- One concern per file. Forward-only: never edit after applying.
-- Filename: NNNN_short_description.sql (zero-padded, sequential).

BEGIN;

CREATE TABLE pricing_tiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,               -- 'retail', 'wholesale-a', ...
  discount_pct numeric(5,2) NOT NULL DEFAULT 0
               CHECK (discount_pct >= 0 AND discount_pct <= 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Additive change to an existing table: nullable first.
-- A later migration backfills, then adds NOT NULL if required.
ALTER TABLE wholesale_accounts
  ADD COLUMN pricing_tier_id uuid REFERENCES pricing_tiers(id) ON DELETE RESTRICT;

CREATE INDEX idx_wholesale_accounts_pricing_tier_id
  ON wholesale_accounts (pricing_tier_id);

COMMIT;
