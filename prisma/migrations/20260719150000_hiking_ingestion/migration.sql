-- Phase 9: hiking logbook/import support and the SAC hiking grade system.
-- Enum additions are forward-only; existing rows and BMG categories are unchanged.
ALTER TYPE "ascent_ledger"."Discipline" ADD VALUE IF NOT EXISTS 'hiking';
ALTER TYPE "ascent_ledger"."GradeSystem" ADD VALUE IF NOT EXISTS 'sac_hiking';
