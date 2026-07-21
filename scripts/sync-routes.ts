import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runSync, importHealthReport } from "../src/lib/importers/sync";
import { openBetaImporter } from "../src/lib/importers/openbeta";
import { camptocampImporter } from "../src/lib/importers/camptocamp";
import { osmOverpassImporter } from "../src/lib/importers/osm-overpass";
import { osmGeofabrikImporter } from "../src/lib/importers/osm-geofabrik";
import { GEOFABRIK_EUROPE_SHARDS } from "../src/lib/importers/geofabrik-registry";
import { nationalTrailsEnglandImporter, nationalTrailsWalesImporter } from "../src/lib/importers/uk-national-trails";
import { natureScotGreatTrailsImporter } from "../src/lib/importers/scotlands-great-trails";
import {
  englandCoastPathImporter, finlandLipasImporter, norwayTrailsImporter,
  swedenTrailsImporter, swissWanderlandImporter,
} from "../src/lib/importers/official-sources";
import type { RouteImporter } from "../src/lib/importers/types";
import { datatourismeImporter } from "../src/lib/importers/datatourisme";

export const REGISTRY: RouteImporter[] = [
  osmGeofabrikImporter,
  openBetaImporter,
  camptocampImporter,
  nationalTrailsEnglandImporter,
  nationalTrailsWalesImporter,
  englandCoastPathImporter,
  natureScotGreatTrailsImporter,
  swedenTrailsImporter,
  datatourismeImporter,
  finlandLipasImporter,
  norwayTrailsImporter,
  swissWanderlandImporter,
  // Manual fallback only; never part of the default Europe-scale schedule.
  osmOverpassImporter,
];

const DEFAULT_SOURCES = new Set([
  "osm_geofabrik", "openbeta", "camptocamp", "national_trails_england",
  "national_trails_wales", "england_coast_path", "sweden_naturvardsverket",
]);

type CliOptions = {
  sources: string[];
  max: number;
  shard?: string;
  activity?: string;
  localFile?: string;
  resume: boolean;
  resetCheckpoint: boolean;
  confirmReset?: string;
  health: boolean;
};

function valueArg(argv: string[], name: string) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function parseArgs(argv: string[]): CliOptions {
  const sourceArg = valueArg(argv, "source");
  const max = Number(valueArg(argv, "max") ?? 200);
  if (!Number.isInteger(max) || max <= 0 || max > 100_000) throw new Error("--max must be between 1 and 100000");
  return {
    sources: sourceArg ? sourceArg.split(",").map((value) => value.trim()).filter(Boolean) : REGISTRY.filter((source) => DEFAULT_SOURCES.has(source.source)).map((source) => source.source),
    max,
    shard: valueArg(argv, "shard"),
    activity: valueArg(argv, "activity"),
    localFile: valueArg(argv, "local-file"),
    resume: !argv.includes("--no-resume"),
    resetCheckpoint: argv.includes("--reset-checkpoint"),
    confirmReset: valueArg(argv, "confirm-reset"),
    health: argv.includes("--health"),
  };
}

function rotatingShard() {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1_000));
  return GEOFABRIK_EUROPE_SHARDS[week % GEOFABRIK_EUROPE_SHARDS.length].key;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const options = parseArgs(process.argv.slice(2));
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    if (options.health) {
      const rows = await importHealthReport(prisma);
      console.table(rows.map((row) => ({ source: row.source, shard: row.shard, activity: row.activity, status: row.status, at: row.runAt.toISOString(), added: row.routesAdded, updated: row.routesUpdated, merged: row.routesMerged, suggested: row.suggestionsCreated, stale: row.routesStale, complete: row.snapshotComplete, cursor: row.cursorEnd })));
      return;
    }
    const unknown = options.sources.filter((source) => !REGISTRY.some((importer) => importer.source === source));
    if (unknown.length) throw new Error(`Unknown source(s): ${unknown.join(", ")}`);
    const importers = REGISTRY.filter((importer) => options.sources.includes(importer.source));
    const shard = options.shard === "rotate" ? rotatingShard() : options.shard;
    if (options.resetCheckpoint) {
      const expected = `${options.sources.join(",")}:${shard ?? "default"}:${options.activity ?? "all"}`;
      if (options.confirmReset !== expected) {
        throw new Error(`Checkpoint reset requires --confirm-reset=${expected}`);
      }
    }
    const results = await runSync(prisma, importers, {
      maxRoutesPerSource: options.max,
      shard,
      activity: options.activity,
      localFile: options.localFile,
      resume: options.resume,
      resetCheckpoint: options.resetCheckpoint,
      log: console.log,
    });
    console.table(results.map(({ errors, ...result }) => ({ ...result, errors: errors.length })));
    if (results.every((result) => result.errors.length > 0)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
