import { z } from "zod";
import { AscentStyle, Discipline, GradeSystem } from "@/generated/prisma/enums";
import { gradeSystemsByDiscipline } from "@/lib/grades";

// Logbook CSV import format (Phase 3). Header row is required; column
// order is free; unknown columns are ignored. See REQUIRED_COLUMNS /
// OPTIONAL_COLUMNS below — this is the documented contract for import
// files.
//
//   date         required  ISO date, e.g. 2025-02-14
//   route_name   required  free text
//   discipline   required  rock | winter | alpine | ski_touring | hiking
//   grade        required  raw grade string, e.g. "E1 5b", "V,6", "TD+"
//   ascent_style required  led | alternate_lead | seconded | solo | roped_solo
//   grade_system optional  uk_trad | french_sport | uiaa | scottish_winter |
//                          wi_ice | alpine_overall | ski_touring_scale |
//                          sac_hiking
//                          (blank = inferred from discipline + grade)
//   area         optional  free text crag/mountain name
//   pitches      optional  positive integer
//   length_m     optional  positive integer
//   partners     optional  names separated by ";"
//   notes        optional  free text

export const REQUIRED_COLUMNS = [
  "date",
  "route_name",
  "discipline",
  "grade",
  "ascent_style",
] as const;

export const OPTIONAL_COLUMNS = [
  "grade_system",
  "area",
  "pitches",
  "length_m",
  "partners",
  "notes",
] as const;

const optionalPositiveInt = z.preprocess(
  (value) => (value === "" || value == null ? undefined : Number(value)),
  z
    .number({ error: "must be a number" })
    .int("must be a whole number")
    .positive("must be positive")
    .optional()
);

export const csvRowSchema = z.object({
  date: z.iso.date({ error: "date must be YYYY-MM-DD" }),
  route_name: z
    .string()
    .trim()
    .min(1, "route_name is required")
    .max(200, "route_name is too long"),
  discipline: z.enum(Discipline, {
    error: `discipline must be one of: ${Object.values(Discipline).join(", ")}`,
  }),
  grade: z
    .string()
    .trim()
    .min(1, "grade is required")
    .max(50, "grade is too long"),
  ascent_style: z.enum(AscentStyle, {
    error: `ascent_style must be one of: ${Object.values(AscentStyle).join(", ")}`,
  }),
  grade_system: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z
      .enum(GradeSystem, {
        error: `grade_system must be blank or one of: ${Object.values(GradeSystem).join(", ")}`,
      })
      .optional()
  ),
  area: z.string().trim().max(120, "area is too long").optional(),
  pitches: optionalPositiveInt,
  length_m: optionalPositiveInt,
  partners: z.string().trim().max(500, "partners is too long").optional(),
  notes: z.string().trim().max(2000, "notes is too long").optional(),
}).refine(
  (row) =>
    !row.grade_system || gradeSystemsByDiscipline[row.discipline].includes(row.grade_system),
  { error: "grade_system does not match discipline", path: ["grade_system"] }
);

export type CsvRow = z.infer<typeof csvRowSchema>;

export type CsvRowError = {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  message: string;
};

export type CsvParseResult = {
  rows: { line: number; row: CsvRow }[];
  errors: CsvRowError[];
  /** Data lines seen (excludes header and blank lines). */
  totalDataLines: number;
};

// Minimal RFC-4180-style parser: quoted fields, escaped quotes (""),
// commas/newlines inside quotes, CRLF or LF line endings.
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Parses and validates a logbook CSV. Invalid rows are reported per line
 * with the reason — never silently dropped; valid rows are returned for
 * import.
 */
export function parseLogbookCsv(text: string): CsvParseResult | { fileError: string } {
  const records = parseCsv(text);
  if (records.length === 0) {
    return { fileError: "The file is empty." };
  }

  const header = records[0].map((cell) => cell.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    return {
      fileError: `Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Expected header: ${[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(",")}`,
    };
  }

  const rows: CsvParseResult["rows"] = [];
  const errors: CsvRowError[] = [];
  let totalDataLines = 0;

  for (let i = 1; i < records.length; i++) {
    const line = i + 1;
    const cells = records[i];
    if (cells.every((cell) => cell.trim() === "")) continue; // blank line
    totalDataLines++;

    const raw: Record<string, string> = {};
    header.forEach((column, index) => {
      raw[column] = (cells[index] ?? "").trim();
    });

    const result = csvRowSchema.safeParse(raw);
    if (result.success) {
      rows.push({ line, row: result.data });
    } else {
      const messages = result.error.issues
        .map((issue) => {
          const field = issue.path[0];
          return field ? `${String(field)}: ${issue.message}` : issue.message;
        })
        .join("; ");
      errors.push({ line, message: messages });
    }
  }

  return { rows, errors, totalDataLines };
}
