"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAreaId } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";
import {
  GPX_BUCKET,
  MAX_PHOTOS_PER_CLIMB,
  PHOTOS_BUCKET,
  removeStoredFiles,
  uploadClimbPhoto,
  uploadGpxTrack,
} from "@/lib/storage";
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
    routeId: formData.get("routeId") || undefined,
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

function toClimbData(input: ClimbInput, areaId: string | null) {
  return {
    routeId: input.routeId ?? null,
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

// Uploads the form's new photo files (input name "photos") and optional
// GPX file, returning URLs — or a user-facing error string.
async function uploadAttachments(
  userId: string,
  formData: FormData,
  existingPhotoCount: number
): Promise<
  | { ok: true; photoUrls: string[]; gpxUrl: string | null }
  | { ok: false; error: string }
> {
  const photoFiles = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const gpxFile = formData.get("gpx");
  const newGpx = gpxFile instanceof File && gpxFile.size > 0 ? gpxFile : null;

  if (existingPhotoCount + photoFiles.length > MAX_PHOTOS_PER_CLIMB) {
    return { ok: false, error: `A climb can have at most ${MAX_PHOTOS_PER_CLIMB} photos.` };
  }
  if (photoFiles.length === 0 && !newGpx) {
    return { ok: true, photoUrls: [], gpxUrl: null };
  }

  const supabase = await createClient();
  const photoUrls: string[] = [];
  for (const file of photoFiles) {
    const result = await uploadClimbPhoto(supabase, userId, file);
    if (!result.ok) return { ok: false, error: result.error };
    photoUrls.push(result.url);
  }

  let gpxUrl: string | null = null;
  if (newGpx) {
    const result = await uploadGpxTrack(supabase, userId, newGpx);
    if (!result.ok) return { ok: false, error: result.error };
    gpxUrl = result.url;
  }

  return { ok: true, photoUrls, gpxUrl };
}

export async function createClimb(
  _prev: ClimbFormState,
  formData: FormData
): Promise<ClimbFormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed.state;

  const uploaded = await uploadAttachments(user.id, formData, 0);
  if (!uploaded.ok) return { error: uploaded.error };

  try {
    const areaId = await resolveAreaId(parsed.input.area);
    await prisma.climb.create({
      data: {
        userId: user.id,
        ...toClimbData(parsed.input, areaId),
        photoUrls: uploaded.photoUrls,
        gpxTrackUrl: uploaded.gpxUrl,
      },
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

  // Ownership check up front — attachment handling needs the current row.
  const existing = await prisma.climb.findFirst({
    where: { id: climbId, userId: user.id },
    select: { photoUrls: true, gpxTrackUrl: true },
  });
  if (!existing) {
    return { error: "This climb no longer exists." };
  }

  const removePhotos = new Set(
    formData.getAll("removePhotos").filter((v): v is string => typeof v === "string")
  );
  const keptPhotos = existing.photoUrls.filter((url) => !removePhotos.has(url));
  const removeGpx = formData.get("removeGpx") === "on";

  const uploaded = await uploadAttachments(user.id, formData, keptPhotos.length);
  if (!uploaded.ok) return { error: uploaded.error };

  const gpxTrackUrl =
    uploaded.gpxUrl ?? (removeGpx ? null : existing.gpxTrackUrl);

  try {
    const areaId = await resolveAreaId(parsed.input.area);
    await prisma.climb.update({
      where: { id: climbId },
      data: {
        ...toClimbData(parsed.input, areaId),
        photoUrls: [...keptPhotos, ...uploaded.photoUrls],
        gpxTrackUrl,
      },
    });
  } catch {
    return { error: "Could not save the climb. Please try again." };
  }

  // Best-effort cleanup of files the save just detached.
  const supabase = await createClient();
  if (removePhotos.size > 0) {
    await removeStoredFiles(supabase, PHOTOS_BUCKET, [...removePhotos]);
  }
  if (existing.gpxTrackUrl && gpxTrackUrl !== existing.gpxTrackUrl) {
    await removeStoredFiles(supabase, GPX_BUCKET, [existing.gpxTrackUrl]);
  }

  revalidatePath("/logbook");
  redirect("/logbook");
}

// Accept/reject a fuzzy climb→route link suggestion. Ownership is enforced
// through the suggestion's climb.userId; accepting links the climb and
// closes any other pending suggestions for it.
export async function resolveSuggestion(formData: FormData): Promise<void> {
  const user = await requireUser();
  const suggestionId = formData.get("suggestionId");
  const decision = formData.get("decision");
  if (
    typeof suggestionId !== "string" ||
    (decision !== "accept" && decision !== "reject")
  ) {
    return;
  }

  const suggestion = await prisma.climbRouteSuggestion.findFirst({
    where: { id: suggestionId, status: "pending", climb: { userId: user.id } },
  });
  if (!suggestion) return;

  if (decision === "accept") {
    await prisma.$transaction([
      prisma.climb.update({
        where: { id: suggestion.climbId },
        data: { routeId: suggestion.routeId },
      }),
      prisma.climbRouteSuggestion.update({
        where: { id: suggestion.id },
        data: { status: "accepted" },
      }),
      // The climb is linked now — other pending candidates are moot.
      prisma.climbRouteSuggestion.updateMany({
        where: {
          climbId: suggestion.climbId,
          status: "pending",
          id: { not: suggestion.id },
        },
        data: { status: "rejected" },
      }),
    ]);
  } else {
    await prisma.climbRouteSuggestion.update({
      where: { id: suggestion.id },
      data: { status: "rejected" },
    });
  }

  revalidatePath("/logbook");
  revalidatePath("/map");
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
