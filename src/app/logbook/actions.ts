"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { climbInputSchema, type ClimbInput } from "@/lib/climbs/validation";
import { normaliseGrade } from "@/lib/grades";

export type ClimbFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof ClimbInput, string>>;
};

function parseForm(formData: FormData):
  | { ok: true; input: ClimbInput }
  | { ok: false; state: ClimbFormState } {
  const result = climbInputSchema.safeParse({
    routeName: formData.get("routeName"),
    discipline: formData.get("discipline"),
    date: formData.get("date"),
    gradeSystem: formData.get("gradeSystem"),
    gradeRaw: formData.get("gradeRaw"),
    ascentStyle: formData.get("ascentStyle"),
    area: formData.get("area") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });

  if (!result.success) {
    const fieldErrors: ClimbFormState["fieldErrors"] = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof ClimbInput | undefined;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { ok: false, state: { fieldErrors } };
  }

  return { ok: true, input: result.data };
}

// Find-or-create an Area from the free-text area field (Phase 1: name only;
// region/coords arrive in Phase 3). Returns null for a blank field.
async function resolveAreaId(name: string | undefined): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const existing = await prisma.area.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.area.create({ data: { name: trimmed } });
    return created.id;
  } catch {
    // Lost a race on the unique(name) constraint — someone (or a parallel
    // request) created it first. Re-read.
    const raced = await prisma.area.findFirst({
      where: { name: { equals: trimmed, mode: "insensitive" } },
    });
    if (raced) return raced.id;
    throw new Error("Could not save the area");
  }
}

function toClimbData(input: ClimbInput, areaId: string | null) {
  return {
    freeTextRouteName: input.routeName,
    discipline: input.discipline,
    date: new Date(input.date),
    gradeSystem: input.gradeSystem,
    gradeRaw: input.gradeRaw,
    // Null when the raw grade doesn't parse against the system's ladder —
    // the climb still saves and shows as "ungraded" on the dashboard.
    gradeNormalisedScore: normaliseGrade(input.gradeSystem, input.gradeRaw),
    ascentStyle: input.ascentStyle,
    areaId,
    notes: input.notes || null,
  };
}

export async function createClimb(
  _prev: ClimbFormState,
  formData: FormData
): Promise<ClimbFormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed.state;

  try {
    const areaId = await resolveAreaId(parsed.input.area);
    await prisma.climb.create({
      data: { userId: user.id, ...toClimbData(parsed.input, areaId) },
    });
  } catch {
    return { error: "Could not save the climb. Please try again." };
  }

  revalidatePath("/logbook");
  redirect("/logbook");
}

export async function updateClimb(
  climbId: string,
  _prev: ClimbFormState,
  formData: FormData
): Promise<ClimbFormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed.state;

  try {
    const areaId = await resolveAreaId(parsed.input.area);
    // updateMany so the WHERE clause enforces ownership in the same query.
    const { count } = await prisma.climb.updateMany({
      where: { id: climbId, userId: user.id },
      data: toClimbData(parsed.input, areaId),
    });
    if (count === 0) {
      return { error: "This climb no longer exists." };
    }
  } catch {
    return { error: "Could not save the climb. Please try again." };
  }

  revalidatePath("/logbook");
  redirect("/logbook");
}

export async function deleteClimb(formData: FormData): Promise<void> {
  const user = await requireUser();
  const climbId = formData.get("climbId");
  if (typeof climbId !== "string" || !climbId) return;

  await prisma.climb.deleteMany({
    where: { id: climbId, userId: user.id },
  });

  revalidatePath("/logbook");
}
