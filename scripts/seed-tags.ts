import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { TagKind } from "../src/generated/prisma/enums";

type TagSeed = { tags: { slug: string; label: string; kind: TagKind }[] };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const seed = JSON.parse(
      readFileSync(join(__dirname, "..", "docs", "tags.seed.json"), "utf8")
    ) as TagSeed;
    for (const tag of seed.tags) {
      await prisma.tag.upsert({
        where: { slug: tag.slug },
        update: { label: tag.label, kind: tag.kind },
        create: tag,
      });
    }
    console.log(`Seeded ${seed.tags.length} curated route tags`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
