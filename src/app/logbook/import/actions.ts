"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAreaId } from "@/lib/areas";
import { normaliseGrade, inferGrade } from "@/lib/grades";
import { parseLogbookCsv, type CsvRowError } from "@/lib/climbs/csv";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type CsvImportState = {
  fileError?: string;
  result?: {
    imported: number;
    totalDataLines: number;
    errors: CsvRowError[];
  };
};

export async function importLogbookCsv(
  _prev: CsvImportState,
  formData: FormData
): Promise<CsvImportState> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { fileError: "Choose a CSV file to import." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { fileError: "File is too large (2 MB maximum)." };
  }

  const parsed = parseLogbookCsv(await file.text());
  if ("fileError" in parsed) {
    return { fileError: parsed.fileError };
  }

  // Resolve each distinct area name once, not per row.
  const areaNames = new Map<string, string>(); // lowercased name -> areaId
  for (const { row } of parsed.rows) {
    const name = row.area?.trim();
    if (!name || areaNames.has(name.toLowerCase())) continue;
    const areaId = await resolveAreaId(name);
    if (areaId) areaNames.set(name.toLowerCase(), areaId);
  }

  const data = parsed.rows.map(({ row }) => {
    // Explicit grade_system wins; otherwise infer from discipline + grade.
    // Either way an unparseable grade imports with a null score (shown as
    // "ungraded" on the dashboard) rather than being rejected.
    const gradeSystem =
      row.grade_system ?? inferGrade(row.discipline, row.grade)?.system ?? null;
    return {
      userId: user.id,
      freeTextRouteName: row.route_name,
      discipline: row.discipline,
      date: new Date(row.date),
      gradeSystem,
      gradeRaw: row.grade,
      gradeNormalisedScore: gradeSystem
        ? normaliseGrade(gradeSystem, row.grade)
        : null,
      ascentStyle: row.ascent_style,
      pitches: row.pitches ?? null,
      lengthM: row.length_m ?? null,
      areaId: row.area ? (areaNames.get(row.area.toLowerCase()) ?? null) : null,
      partners: row.partners
        ? row.partners.split(";").map((p) => p.trim()).filter(Boolean)
        : [],
      notes: row.notes || null,
      source: "csv_import" as const,
    };
  });

  let imported = 0;
  if (data.length > 0) {
    const { count } = await prisma.climb.createMany({ data });
    imported = count;
  }

  revalidatePath("/logbook");
  revalidatePath("/dashboard");

  return {
    result: {
      imported,
      totalDataLines: parsed.totalDataLines,
      errors: parsed.errors,
    },
  };
}
