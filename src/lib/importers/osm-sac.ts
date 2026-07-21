const SAC_TO_T_GRADE: Record<string, string> = {
  strolling: "T1",
  hiking: "T1",
  mountain_hiking: "T2",
  demanding_mountain_hiking: "T3",
  alpine_hiking: "T4",
  demanding_alpine_hiking: "T5",
  difficult_alpine_hiking: "T6",
};

export function normaliseSacScale(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (SAC_TO_T_GRADE[normalized]) return SAC_TO_T_GRADE[normalized];
  const tGrade = normalized.toUpperCase().match(/^T([1-6])(?:\b|$)/);
  return tGrade ? `T${tGrade[1]}` : null;
}

export function hardestSacScale(values: Iterable<string | null | undefined>): {
  gradeRaw: string | null;
  rawValues: string[];
} {
  const rawValues: string[] = [];
  let hardest: string | null = null;
  for (const value of values) {
    if (!value?.trim()) continue;
    rawValues.push(value.trim());
    const grade = normaliseSacScale(value);
    if (grade && (!hardest || Number(grade.slice(1)) > Number(hardest.slice(1)))) hardest = grade;
  }
  return { gradeRaw: hardest, rawValues: [...new Set(rawValues)] };
}

