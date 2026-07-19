import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runSync } from "../src/lib/importers/sync";
import { openBetaImporter } from "../src/lib/importers/openbeta";
import { camptocampImporter } from "../src/lib/importers/camptocamp";
import { osmOverpassImporter } from "../src/lib/importers/osm-overpass";
import {
  nationalTrailsEnglandImporter,
  nationalTrailsWalesImporter,
} from "../src/lib/importers/uk-national-trails";
import { natureScotGreatTrailsImporter } from "../src/lib/importers/scotlands-great-trails";
import type { RouteImporter } from "../src/lib/importers/types";

// Route-database sync — run manually (`npm run sync:routes`) or on the
// weekly GitHub Actions cron (.github/workflows/sync-routes.yml).
//
//   npm run sync:routes -- --source=openbeta,camptocamp --max=200
//
//   --source  comma-separated subset of sources (default: all)
//   --max     max routes fetched per source per run (default: 200 — keep
//             this modest; the job is weekly and APIs are shared goods)

const REGISTRY: RouteImporter[] = [
  openBetaImporter,
  camptocampImporter,
  osmOverpassImporter,
  nationalTrailsEnglandImporter,
  nationalTrailsWalesImporter,
  natureScotGreatTrailsImporter,
];

function parseArgs(argv: string[]): { sources: string[]; max: number } {
  let sources = REGISTRY.map((i) => i.source);
  let max = 200;
  for (const arg of argv) {
    const sourceMatch = arg.match(/^--source=(.+)$/);
    if (sourceMatch) sources = sourceMatch[1].split(",").map((s) => s.trim());
    const maxMatch = arg.match(/^--max=(\d+)$/);
    if (maxMatch) max = Number(maxMatch[1]);
  }
  return { sources, max };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const { sources, max } = parseArgs(process.argv.slice(2));
  const importers = REGISTRY.filter((i) => sources.includes(i.source));
  if (importers.length === 0) {
    throw new Error(
      `No matching importers for --source=${sources.join(",")} (available: ${REGISTRY.map((i) => i.source).join(", ")})`
    );
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
