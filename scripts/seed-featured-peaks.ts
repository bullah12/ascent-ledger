import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

type FeaturedPeak = {
  slug: string;
  name: string;
  region: string;
  country: string;
  route: string;
  difficulty: string;
  summary: string;
  source_url: string | null;
};
type ExtraRoute = Pick<FeaturedPeak, "route" | "difficulty" | "summary" | "source_url"> & { peak_slug: string };

const SOURCE = "ascent_ledger_featured";
const seed = JSON.parse(readFileSync(join(__dirname, "..", "docs", "featured_peaks.seed.json"), "utf8")) as {
  curated_at: string;
  peaks: FeaturedPeak[];
  extra_routes: ExtraRoute[];
};

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL_POOLER;
if (!connectionString) throw new Error("DATABASE_URL or DIRECT_URL_POOLER is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  if (seed.peaks.length !== 50 || new Set(seed.peaks.map((peak) => peak.slug)).size !== 50) {
    throw new Error("Featured peak seed must contain exactly 50 unique peaks");
  }

  for (const entry of seed.peaks) {
    const peak = await prisma.peak.upsert({
      where: { slug: entry.slug },
      update: { name: entry.name, region: entry.region, country: entry.country, summary: entry.summary,
        imagePath: `/peaks/${entry.slug}.svg` },
      create: { slug: entry.slug, name: entry.name, region: entry.region, country: entry.country,
        summary: entry.summary, imagePath: `/peaks/${entry.slug}.svg` },
    });
    const area = await prisma.area.upsert({
      where: { name: entry.name },
      update: { region: entry.region, country: entry.country },
      create: { name: entry.name, region: entry.region, country: entry.country },
    });
    await prisma.route.upsert({
      where: { externalSource_externalId: { externalSource: SOURCE, externalId: entry.slug } },
      update: {
        name: `${entry.name} — ${entry.route}`, areaId: area.id, peakId: peak.id,
        gradeRaw: entry.difficulty, description: entry.summary, externalUrl: entry.source_url,
        publicationState: "approved", verificationStatus: "verified",
        verificationReason: `Editorially curated featured route (${seed.curated_at}); distance and geometry not verified`,
        moderationReason: "Featured mountain route overview", moderationLocked: true,
      },
      create: {
        name: `${entry.name} — ${entry.route}`, areaId: area.id, peakId: peak.id,
        discipline: "hiking", gradeRaw: entry.difficulty, description: entry.summary,
        externalSource: SOURCE, externalId: entry.slug, externalUrl: entry.source_url,
        origin: "imported", publicationState: "approved", verificationStatus: "verified",
        verificationReason: `Editorially curated featured route (${seed.curated_at}); distance and geometry not verified`,
        moderationReason: "Featured mountain route overview", moderationLocked: true,
        sourceAuthority: "Ascent Ledger editorial", policyVersion: "route-quality-v1",
        qualityScore: 60, moderatedAt: new Date(`${seed.curated_at}T00:00:00.000Z`),
      },
    });
  }

  for (const entry of seed.extra_routes) {
    const peak = await prisma.peak.findUniqueOrThrow({ where: { slug: entry.peak_slug } });
    const area = await prisma.area.findUniqueOrThrow({ where: { name: peak.name } });
    const externalId = `${entry.peak_slug}:${entry.route.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    await prisma.route.upsert({
      where: { externalSource_externalId: { externalSource: SOURCE, externalId } },
      update: {
        name: `${peak.name} — ${entry.route}`, areaId: area.id, peakId: peak.id,
        gradeRaw: entry.difficulty, description: entry.summary, externalUrl: entry.source_url,
        publicationState: "approved", verificationStatus: "verified",
        verificationReason: `Editorially curated featured route (${seed.curated_at}); distance and geometry not verified`,
        moderationReason: "Featured mountain route overview", moderationLocked: true,
      },
      create: {
        name: `${peak.name} — ${entry.route}`, areaId: area.id, peakId: peak.id,
        discipline: "hiking", gradeRaw: entry.difficulty, description: entry.summary,
        externalSource: SOURCE, externalId, externalUrl: entry.source_url,
        origin: "imported", publicationState: "approved", verificationStatus: "verified",
        verificationReason: `Editorially curated featured route (${seed.curated_at}); distance and geometry not verified`,
        moderationReason: "Featured mountain route overview", moderationLocked: true,
        sourceAuthority: "Ascent Ledger editorial", policyVersion: "route-quality-v1",
        qualityScore: 60, moderatedAt: new Date(`${seed.curated_at}T00:00:00.000Z`),
      },
    });
  }

  console.log(`Upserted ${seed.peaks.length} featured peaks and ${seed.peaks.length + seed.extra_routes.length} routes`);
}

main().then(() => prisma.$disconnect()).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
