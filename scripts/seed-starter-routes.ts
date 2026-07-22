import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Discipline, GradeSystem } from "../src/generated/prisma/enums";
import { normaliseGrade } from "../src/lib/grades";

type StarterRoute = {
  source: "camptocamp" | "national_trails_england";
  external_id: string;
  name: string;
  discipline: Discipline;
  grade_system: GradeSystem | null;
  grade: string | null;
  lat: number;
  lng: number;
  length_m: number | null;
  quality: number | null;
  area: string;
  region: string;
  country: string;
};

type StarterSeed = {
  verified_at: string;
  sources: Record<string, { licence: string; url: string }>;
  routes: StarterRoute[];
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function sourceUrl(route: StarterRoute): string {
  return route.source === "camptocamp"
    ? `https://www.camptocamp.org/routes/${route.external_id}`
    : "https://www.data.gov.uk/dataset/ac8c851c-99a0-4488-8973-6c8863529c45/national-trails-england3";
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const path = join(__dirname, "..", "docs", "starter_routes.seed.json");
  const seed = JSON.parse(readFileSync(path, "utf8")) as StarterSeed;

  for (const route of seed.routes) {
    if (!seed.sources[route.source]) throw new Error(`Unknown source ${route.source}`);
    const area = await prisma.area.upsert({
      where: { name: route.area },
      update: { region: route.region, country: route.country },
      create: { name: route.area, region: route.region, country: route.country },
    });
    const gradeScore =
      route.grade && route.grade_system
        ? normaliseGrade(route.grade_system, route.grade)
        : null;
    // French sport/UIAA ladders are intentionally still stubs; preserve their
    // verified raw grade and leave the normalised score null, matching imports.

    await prisma.route.upsert({
      where: {
        externalSource_externalId: {
          externalSource: route.source,
          externalId: route.external_id,
        },
      },
      update: {
        starterDisciplines: [route.discipline], origin: "imported",
        publicationState: "approved", verificationStatus: "verified",
        verificationReason: `Manually verified starter seed ${seed.verified_at}`,
        moderationReason: "Curated onboarding starter route", qualityScore: 100,
        sourceAuthority: route.source, policyVersion: "route-quality-v1", moderatedAt: new Date(`${seed.verified_at}T00:00:00.000Z`),
        moderationLocked: true,
      },
      create: {
        name: route.name,
        discipline: route.discipline,
        gradeSystem: route.grade_system,
        gradeRaw: route.grade,
        gradeNormalisedScore: gradeScore,
        lat: route.lat,
        lng: route.lng,
        lengthM: route.length_m,
        qualityRating: route.quality,
        areaId: area.id,
        externalSource: route.source,
        externalId: route.external_id,
        externalUrl: sourceUrl(route),
        lastSyncedAt: new Date(`${seed.verified_at}T00:00:00.000Z`),
        starterDisciplines: [route.discipline],
        origin: "imported",
        publicationState: "approved",
        verificationStatus: "verified",
        verificationReason: `Manually verified starter seed ${seed.verified_at}`,
        moderationReason: "Curated onboarding starter route",
        qualityScore: 100,
        sourceAuthority: route.source,
        policyVersion: "route-quality-v1",
        moderatedAt: new Date(`${seed.verified_at}T00:00:00.000Z`),
        moderationLocked: true,
      },
    });
  }

  console.log(`Seeded ${seed.routes.length} starter routes (verified ${seed.verified_at})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
