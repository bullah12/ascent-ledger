import { defineConfig } from "@playwright/test";

// E2E setup (PLAN.md §7 Phase 7). Prerequisites:
//   - Postgres reachable at E2E_DATABASE_URL (or DATABASE_URL), with
//     migrations applied, BMG rules seeded (npm run db:seed) and at least
//     some routes imported so recommendations exist (e.g.
//     npm run sync:routes -- --file=docs/scottish_winter_seed.example.csv)
//   - Run via `npm run test:e2e` — it builds the app with the mock
//     Supabase URL baked into the client bundle, then starts the mock
//     auth server + `next start` below.

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://ascent:ascent@localhost:5432/ascent_ledger";

export const E2E_SUPABASE_URL = "http://127.0.0.1:54321";
export const E2E_SUPABASE_ANON_KEY = "e2e-anon-key";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // Optional escape hatch for environments with a system Chromium
    // instead of Playwright's own download (unset = default resolution).
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
      : {}),
  },
  webServer: [
    {
      command: "npx tsx e2e/mock-supabase.ts",
      url: "http://127.0.0.1:54321/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run start",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL,
        NEXT_PUBLIC_SUPABASE_URL: E2E_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: E2E_SUPABASE_ANON_KEY,
      },
    },
  ],
});
