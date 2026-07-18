import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runSync } from "../src/lib/importers/sync";
import { openBetaImporter } from "../src/lib/importers/openbeta";
import { camptocampImporter } from "../src/lib/importers/camptocamp";
import { manualCsvImporter } from "../src/lib/importers/manual-csv";
import type { RouteImporter } from "../src/lib/importers/types";

// Route-database sync — run manually (`npm run sync:routes`) or on the
// weekly GitHub Actions cron (.github/workflows/sync-routes.yml).
//
//   npm run sync:routes -- --source=openbeta,camptocamp --max=200
//   npm run sync:routes -- --file=docs/scottish_winter_seed.csv
//
//   --source  comma-separated subset of API sources (default: all)
//   --max     max routes fetched per source per run (default: 200 — keep
//             this modest; the job is weekly and APIs are shared goods)
//   --file    seed/refresh curated routes from a CSV (see
//             src/lib/importers/manual-csv.ts for the format). When given,
//             ONLY the CSV is imported unless --source is also passed.

const REGISTRY: RouteImporter[] = [openBetaImporter, camptocampImporter];

function parseArgs(argv: string[]): {
  sources: string[] | null;
  max: number;
  file: string | null;
} {
  let sources: string[] | null = null;
  let max = 200;
  let file: string | null = null;
  for (const arg of argv) {
    const sourceMatch = arg.match(/^--source=(.+)$/);
    if (sourceMatch) sources = sourceMatch[1].split(",").map((s) => s.trim());
    const maxMatch = arg.match(/^--max=(\d+)$/);
    if (maxMatch) max = Number(maxMatch[1]);
    const fileMatch = arg.match(/^--file=(.+)$/);
    if (fileMatch) file = fileMatch[1];
  }
  return { sources, max, file };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const { sources, max, file } = parseArgs(process.argv.slice(2));
  const importers: RouteImporter[] = [];
  if (sources !== null || file === null) {
    const wanted = sources ?? REGISTRY.map((i) => i.source);
    importers.push(...REGISTRY.filter((i) => wanted.includes(i.source)));
    if (importers.length === 0) {
      throw new Error(
        `No matching importers for --source=${wanted.join(",")} (available: ${REGISTRY.map((i) => i.source).join(", ")})`
      );
    }
  }
  if (file !== null) {
    importers.push(manualCsvImporter(file));
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const results = await runSync(prisma, importers, {
      maxRoutesPerSource: max,
      log: (message) => console.log(message),
    });

    console.log("\n=== sync summary ===");
    let failed = false;
    for (const result of results) {
      console.log(
        `${result.source}: ${result.added} added, ${result.updated} updated, ${result.errors.length} error(s)`
      );
      for (const error of result.errors.slice(0, 5)) {
        console.log(`  ! ${error.route ?? ""} ${error.message}`);
      }
      if (result.added + result.updated === 0 && result.errors.length > 0) {
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
