import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI configuration (Prisma 7+): only the CLI (migrate, db pull,
// studio) reads this URL — the app connects via the pg adapter in
// src/lib/prisma.ts using DATABASE_URL. Against Supabase, set DIRECT_URL to
// the non-pooled (port 5432) connection for migrations; it falls back to
// DATABASE_URL (pooled) if unset.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
