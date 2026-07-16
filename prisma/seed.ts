import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Discipline, GradeSystem } from "../src/generated/prisma/enums";
import { inferGrade } from "../src/lib/grades";

// Seeds BmgCategory/BmgRule from docs/bmg_rules.seed.json — the verified
// rule numbers live in that file, never here. Re-running resets the rules
// tables to the seed file's contents (categories are upserted by key; each
// category's rules are replaced wholesale).
//
// min_grade strings are converted to ordinal scores via the grade ladders,
// inferring the grade system from the string itself within the category's
// discipline (so winter rules can mix Scottish "V" and icefall "WI4").

type SeedRule = {
  description: string;
  min_grade: string | null;
  min_count: number;
  extra_constraint: Record<string, unknown>;
  verified: boolean;
  source_note: string;
};

type SeedFile = {
  categories: {
    key: Discipline;
    label: string;
    rules: SeedRule[];
  }[];
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const seedPath = join(__dirname, "..", "docs", "bmg_rules.seed.json");
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as SeedFile;

  for (const [index, category] of seed.categories.entries()) {
    const dbCategory = await prisma.bmgCategory.upsert({
      where: { key: category.key },
      update: { label: category.label, sortOrder: index },
      create: { key: category.key, label: category.label, sortOrder: index },
    });

    await prisma.bmgRule.deleteMany({ where: { categoryId: dbCategory.id } });

    for (const [ruleIndex, rule] of category.rules.entries()) {
      let gradeSystem: GradeSystem | null = null;
      let minScore: number | null = null;

      if (rule.min_grade) {
        const parsed = inferGrade(category.key, rule.min_grade);
        if (!parsed) {
          throw new Error(
            `Seed rule "${rule.description}": min_grade "${rule.min_grade}" ` +
              `does not parse in any ${category.key} grade ladder`
          );
        }
        gradeSystem = parsed.system;
        minScore = parsed.score;
      }

      await prisma.bmgRule.create({
        data: {
          categoryId: dbCategory.id,
          description: rule.description,
          gradeSystem,
          minGradeRaw: rule.min_grade,
          minGradeNormalisedScore: minScore,
          minCount: rule.min_count,
          extraConstraintJson: JSON.parse(JSON.stringify(rule.extra_constraint)),
          verified: rule.verified,
          sourceNote: rule.source_note,
          sortOrder: ruleIndex,
        },
      });
    }

    console.log(`Seeded ${category.key}: ${category.rules.length} rule(s)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
