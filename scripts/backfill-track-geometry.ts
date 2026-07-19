import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { PathSource } from "../src/generated/prisma/enums";
import {
  TrackError,
  parseTrackText,
  pathSourceForFormat,
  trackFormatFromFilename,
} from "../src/lib/tracks";

type Options = { force: boolean; dryRun: boolean; limit: number };

function parseArgs(args: string[]): Options {
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("--limit must be an integer between 1 and 10000");
  }
  return {
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
    limit,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const climbs = await prisma.climb.findMany({
      where: {
        gpxTrackUrl: { not: null },
        ...(options.force ? {} : { pathSource: null }),
      },
      select: { id: true, freeTextRouteName: true, gpxTrackUrl: true },
      orderBy: { createdAt: "asc" },
      take: options.limit,
    });

    let updated = 0;
    let failed = 0;
    for (const climb of climbs) {
      try {
        const url = climb.gpxTrackUrl!;
        const format = trackFormatFromFilename(new URL(url).pathname) ?? "gpx";
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`download returned HTTP ${response.status}`);
        const geometry = parseTrackText(await response.text(), format);

        if (!options.dryRun) {
          await prisma.climb.update({
            where: { id: climb.id },
            data: {
              pathGeojson: geometry as unknown as Prisma.InputJsonValue,
              pathSource: pathSourceForFormat(format) as PathSource,
            },
          });
        }
        updated++;
        console.log(
          `${options.dryRun ? "would update" : "updated"} ${climb.id} ${climb.freeTextRouteName} (${geometry.coordinates.length} points)`
        );
      } catch (error) {
        failed++;
        const message =
          error instanceof TrackError || error instanceof Error ? error.message : String(error);
        console.error(`failed ${climb.id} ${climb.freeTextRouteName}: ${message}`);
      }
    }

    console.log(
      `track backfill: ${updated} ${options.dryRun ? "ready" : "updated"}, ${failed} failed, ${climbs.length} inspected`
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
