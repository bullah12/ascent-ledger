import "dotenv/config";
import { defineConfig } from "prisma/config";

function migrationUrl() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
  if (!url || /(?:\?|&)schema=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}schema=ascent_ledger`;
}

// Prisma CLI configuration (Prisma 7+): only the CLI (migrate, db pull,
// studio) reads this URL — the app connects via the pg adapter in
// src/lib/prisma.ts using DATABASE_URL. Against Supabase, set DIRECT_URL to
// the non-pooled (port 5432) connection for migrations; it falls back to
// DATABASE_URL (pooled) if unset. The migration connection explicitly uses
// ascent_ledger so Prisma can find ascent_ledger._prisma_migrations before it
// executes any migration SQL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: migrationUrl(),
  },
  migrations: {
    // `prisma db seed` / post-migrate seeding — same script as `npm run db:seed`.
    seed: "tsx prisma/seed.ts",
  },
});
