"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAreaId } from "@/lib/areas";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_PHOTOS_PER_CLIMB,
  MAX_TRACK_BYTES,
  PHOTOS_BUCKET,
  TRACKS_BUCKET,
  removeStoredFiles,
  uploadClimbPhoto,
  uploadTrackFile,
} from "@/lib/storage";
import { climbInputSchema, type ClimbInput } from "@/lib/climbs/validation";
import { normaliseGrade } from "@/lib/grades";
import { Prisma } from "@/generated/prisma/client";
import { PathSource } from "@/generated/prisma/enums";
import type { LineString } from "geojson";
import {
  TrackError,
  parseSubmittedTrack,
  parseTrackFile,
  pathSourceForFormat,
  type TrackPathSource,
} from "@/lib/tracks";

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

type TrackSubmission = {
  geometry: LineString | null;
  source: TrackPathSource | null;
};

function parseTrackSubmission(formData: FormData):
  | { ok: true; track: TrackSubmission }
  | { ok: false; error: string } {
  try {
    const geometry = parseSubmittedTrack(formData.get("pathGeojson"));
    if (!geometry) return { ok: true, track: { geometry: null, source: null } };
    const rawSource = formData.get("pathSource");
    const source =
      typeof rawSource === "string" && Object.values(PathSource).includes(rawSource as PathSource)
        ? (rawSource as TrackPathSource)
        : "drawn";
    return { ok: true, track: { geometry, source } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof TrackError ? error.message : "Track geometry is invalid",
    };
  }
}

// Uploads new photos and an optional raw GPX/KML source, parsing the track on
// the server before it is persisted.
async function uploadAttachments(
  userId: string,
  formData: FormData,
  existingPhotoCount: number
): Promise<
  | {
      ok: true;
      photoUrls: string[];
      rawTrackUrl: string | null;
      importedTrack: TrackSubmission | null;
    }
  | { ok: false; error: string }
> {
  const photoFiles = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const trackFile = formData.get("trackFile");
  const newTrack = trackFile instanceof File && trackFile.size > 0 ? trackFile : null;

  if (existingPhotoCount + photoFiles.length > MAX_PHOTOS_PER_CLIMB) {
    return { ok: false, error: `A climb can have at most ${MAX_PHOTOS_PER_CLIMB} photos.` };
  }
  if (photoFiles.length === 0 && !newTrack) {
    return { ok: true, photoUrls: [], rawTrackUrl: null, importedTrack: null };
  }

  let importedTrack: TrackSubmission | null = null;
  if (newTrack) {
    if (newTrack.size > MAX_TRACK_BYTES) {
      return { ok: false, error: "Track file is over 5 MB" };
    }
    try {
      const parsed = await parseTrackFile(newTrack);
      importedTrack = {
        geometry: parsed.geometry,
        source: pathSourceForFormat(parsed.format),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof TrackError ? error.message : "Could not parse the track file",
      };
    }
  }

  const supabase = await createClient();
  const photoUrls: string[] = [];
  for (const file of photoFiles) {
    const result = await uploadClimbPhoto(supabase, userId, file);
    if (!result.ok) return { ok: false, error: result.error };
    photoUrls.push(result.url);
  }

  let rawTrackUrl: string | null = null;
  if (newTrack) {
    const result = await uploadTrackFile(supabase, userId, newTrack);
    if (!result.ok) return { ok: false, error: result.error };
    rawTrackUrl = result.url;
  }

  return { ok: true, photoUrls, rawTrackUrl, importedTrack };
}

export async function createClimb(
  _prev: ClimbFormState,
  formData: FormData
): Promise<ClimbFormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed.state;
  const submittedTrack = parseTrackSubmission(formData);
  if (!submittedTrack.ok) return { error: submittedTrack.error };

  const uploaded = await uploadAttachments(user.id, formData, 0);
  if (!uploaded.ok) return { error: uploaded.error };
  const track =
    submittedTrack.track.source === "drawn" && submittedTrack.track.geometry
      ? submittedTrack.track
      : uploaded.importedTrack ?? submittedTrack.track;

  try {
    const areaId = await resolveAreaId(parsed.input.area);
    await prisma.climb.create({
      data: {
        userId: user.id,
        ...toClimbData(parsed.input, areaId),
        photoUrls: uploaded.photoUrls,
        gpxTrackUrl: uploaded.rawTrackUrl,
        pathGeojson:
          (track.geometry as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        pathSource: track.geometry ? (track.source as PathSource) : null,
      },
    });
  } catch {
    return { error: "Could not save the climb. Please try again." };
  }

  revalidatePath("/logbook");
  revalidatePath("/map");
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
  const submittedTrack = parseTrackSubmission(formData);
  if (!submittedTrack.ok) return { error: submittedTrack.error };

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
  const removeTrackFile = formData.get("removeTrackFile") === "on";

  const uploaded = await uploadAttachments(user.id, formData, keptPhotos.length);
  if (!uploaded.ok) return { error: uploaded.error };

  const gpxTrackUrl =
    uploaded.rawTrackUrl ?? (removeTrackFile ? null : existing.gpxTrackUrl);
  const track =
    submittedTrack.track.source === "drawn" && submittedTrack.track.geometry
      ? submittedTrack.track
      : uploaded.importedTrack ?? submittedTrack.track;

  try {
    const areaId = await resolveAreaId(parsed.input.area);
    await prisma.climb.update({
      where: { id: climbId },
      data: {
        ...toClimbData(parsed.input, areaId),
        photoUrls: [...keptPhotos, ...uploaded.photoUrls],
        gpxTrackUrl,
        pathGeojson:
          (track.geometry as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        pathSource: track.geometry ? (track.source as PathSource) : null,
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
    await removeStoredFiles(supabase, TRACKS_BUCKET, [existing.gpxTrackUrl]);
  }

  revalidatePath("/logbook");
  revalidatePath("/map");
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
