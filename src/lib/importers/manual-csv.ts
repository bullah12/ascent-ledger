import { readFileSync } from "node:fs";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { parseCsv } from "@/lib/climbs/csv";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

// Manual CSV route importer (PLAN.md §5 point 4) — the curated-seed path
// for data with no open API, e.g. classic Scottish winter routes
// (PLAN.md §5 point 2: hand-entered public knowledge, never scraped).
//
// File format (header required, order free, unknown columns ignored):
//   name         required  route name
//   area         required  crag/mountain, e.g. "Ben Nevis"
//   grade        required  raw grade, e.g. "V,5"
//   lat, lng     optional  WGS84 decimal degrees (both or neither)
//   discipline   optional  rock|winter|alpine|ski_touring (default winter)
//   grade_system optional  default scottish_winter
//   region       optional  default "Scotland"
//   country      optional  default "United Kingdom"
//
// Rows are upserted on (source="manual_csv", externalId=slug(name|area)),
// so re-running after editing the file updates in place. Errors on a row
// throw with the line number — a curated file should be fixed, not
// silently skipped.

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const DISCIPLINES = new Set<string>(Object.values(Discipline));
const GRADE_SYSTEMS = new Set<string>(Object.values(GradeSystem));

export function manualCsvImporter(filePath: string): RouteImporter {
  return {
    source: "manual_csv",

    async *fetchRoutes({ maxRoutes, log }: ImporterOptions) {
      const records = parseCsv(readFileSync(filePath, "utf8"));
      if (records.length < 2) {
        throw new Error(`${filePath}: no data rows`);
      }
      const header = records[0].map((c) => c.trim().toLowerCase());
      for (const required of ["name", "area", "grade"]) {
        if (!header.includes(required)) {
          throw new Error(`${filePath}: missing required column "${required}"`);
        }
      }

      let yielded = 0;
      for (let i = 1; i < records.length && yielded < maxRoutes; i++) {
        const cells = records[i];
        if (cells.every((c) => c.trim() === "")) continue;
        const row: Record<string, string> = {};
        header.forEach((col, idx) => {
          row[col] = (cells[idx] ?? "").trim();
        });

        const line = i + 1;
        if (!row.name || !row.area || !row.grade) {
          throw new Error(`${filePath}:${line}: name, area and grade are required`);
        }
        const discipline = (row.discipline || "winter") as Discipline;
        if (!DISCIPLINES.has(discipline)) {
          throw new Error(`${filePath}:${line}: unknown discipline "${row.discipline}"`);
        }
        const gradeSystem = (row.grade_system || "scottish_winter") as GradeSystem;
        if (!GRADE_SYSTEMS.has(gradeSystem)) {
          throw new Error(`${filePath}:${line}: unknown grade_system "${row.grade_system}"`);
        }
        const lat = row.lat ? Number(row.lat) : null;
        const lng = row.lng ? Number(row.lng) : null;
        if ((lat === null) !== (lng === null)) {
          throw new Error(`${filePath}:${line}: provide both lat and lng, or neither`);
        }
        if ((lat !== null && (Number.isNaN(lat) || Math.abs(lat) > 90)) ||
            (lng !== null && (Number.isNaN(lng) || Math.abs(lng) > 180))) {
          throw new Error(`${filePath}:${line}: invalid coordinates`);
        }

        const route: ExternalRoute = {
          externalId: slug(`${row.name}|${row.area}`),
          externalUrl: null,
          name: row.name,
          discipline,
          gradeSystem,
          gradeRaw: row.grade,
          lat,
          lng,
          lengthM: null,
          pitches: null,
          description: null,
          qualityRating: null,
          area: {
            name: row.area,
            region: row.region || "Scotland",
            country: row.country || "United Kingdom",
          },
        };
        yielded++;
        yield route;
      }
      log?.(`manual_csv: ${yielded} routes from ${filePath}`);
    },
  };
}
