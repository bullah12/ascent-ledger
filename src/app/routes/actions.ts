"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normaliseGrade } from "@/lib/grades";
import { routeInputSchema, type RouteInput } from "@/lib/routes/validation";
import { Prisma } from "@/generated/prisma/client";
import { PathSource } from "@/generated/prisma/enums";
import type { LineString } from "geojson";
import {
  TrackError,
  lineStartPoint,
  parseSubmittedTrack,
  parseTrackFile,
  pathSourceForFormat,
  type TrackPathSource,
} from "@/lib/tracks";
import { MAX_TRACK_BYTES } from "@/lib/storage";
import { ownedCustomTrailWhere } from "@/lib/routes/custom-trails";

export type RouteFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof RouteInput, string>>;
};

function parseRouteForm(formData: FormData):
  | { ok: true; input: RouteInput }
  | { ok: false; state: RouteFormState } {
  const result = routeInputSchema.safeParse({
    name: formData.get("name"),
    discipline: formData.get("discipline"),
    gradeSystem: formData.get("gradeSystem"),
    gradeRaw: formData.get("gradeRaw") ?? undefined,
    area: formData.get("area") ?? undefined,
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    lengthM: formData.get("lengthM"),
    ascentM: formData.get("ascentM"),
    estimatedDurationMins: formData.get("estimatedDurationMins"),
    description: formData.get("description") ?? undefined,
  });

  if (!result.success) {
    const fieldErrors: RouteFormState["fieldErrors"] = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof RouteInput | undefined;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ok: false, state: { fieldErrors } };
  }
  return { ok: true, input: result.data };
}

async function parseRouteTrack(formData: FormData): Promise<
  | { ok: true; geometry: LineString | null; source: TrackPathSource | null }
  | { ok: false; error: string }
> {
  try {
    const submittedGeometry = parseSubmittedTrack(formData.get("pathGeojson"));
    const rawSource = formData.get("pathSource");
    const submittedSource =
      submittedGeometry &&
      typeof rawSource === "string" &&
      Object.values(PathSource).includes(rawSource as PathSource)
        ? (rawSource as TrackPathSource)
        : submittedGeometry
          ? "drawn"
          : null;

    const file = formData.get("trackFile");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: true, geometry: submittedGeometry, source: submittedSource };
    }
    if (file.size > MAX_TRACK_BYTES) {
      return { ok: false, error: "Track file is over 5 MB" };
    }
    const imported = await parseTrackFile(file);
    if (submittedGeometry && submittedSource === "drawn") {
      return { ok: true, geometry: submittedGeometry, source: "drawn" };
    }
    return {
      ok: true,
      geometry: imported.geometry,
      source: pathSourceForFormat(imported.format),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof TrackError ? error.message : "Track geometry is invalid",
    };
  }
}

function routeData(
  input: RouteInput,
  geometry: LineString | null,
  source: TrackPathSource | null
) {
  const start = geometry ? lineStartPoint(geometry) : null;
  return {
    name: input.name,
    discipline: input.discipline,
    gradeSystem: input.gradeRaw ? input.gradeSystem : null,
    gradeRaw: input.gradeRaw || null,
    gradeNormalisedScore: input.gradeRaw
      ? normaliseGrade(input.gradeSystem, input.gradeRaw)
      : null,
    areaName: input.area || null,
    lat: start?.lat ?? input.lat ?? null,
    lng: start?.lng ?? input.lng ?? null,
    pathGeojson: (geometry as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
    pathSource: geometry ? (source as PathSource) : null,
    lengthM: input.lengthM ?? null,
    ascentM: input.ascentM ?? null,
    estimatedDurationMins: input.estimatedDurationMins ?? null,
    description: input.description || null,
  };
}

export async function createCustomTrail(
  _prev: RouteFormState,
  formData: FormData
): Promise<RouteFormState> {
  const user = await requireUser();

  const parsed = parseRouteForm(formData);
  if (!parsed.ok) return parsed.state;
  const track = await parseRouteTrack(formData);
  if (!track.ok) return { error: track.error };

  let trailId: string;
  try {
    const trail = await prisma.customTrail.create({
      data: {
        ownerId: user.id,
        ...routeData(parsed.input, track.geometry, track.source),
      },
    });
    trailId = trail.id;
  } catch {
    return { error: "Could not save your trail. Please try again." };
  }
  revalidatePath("/my-trails");
  redirect(`/my-trails/${trailId}`);
}

export async function updateCustomTrail(
  trailId: string,
  _prev: RouteFormState,
  formData: FormData
): Promise<RouteFormState> {
  const user = await requireUser();
  const parsed = parseRouteForm(formData);
  if (!parsed.ok) return parsed.state;
  const track = await parseRouteTrack(formData);
  if (!track.ok) return { error: track.error };

  const existing = await prisma.customTrail.findFirst({ where: ownedCustomTrailWhere(user.id, trailId), select: { id: true } });
  if (!existing) return { error: "This trail no longer exists." };

  try {
    await prisma.customTrail.update({
      where: { id: trailId },
      data: routeData(parsed.input, track.geometry, track.source),
    });
  } catch {
    return { error: "Could not save your trail. Please try again." };
  }

  revalidatePath("/my-trails");
  revalidatePath(`/my-trails/${trailId}`);
  revalidatePath("/map");
  redirect(`/my-trails/${trailId}`);
}

export async function deleteCustomTrail(formData: FormData): Promise<void> {
  const user = await requireUser();
  const trailId = formData.get("trailId");
  if (typeof trailId !== "string") return;
  await prisma.customTrail.deleteMany({ where: ownedCustomTrailWhere(user.id, trailId) });
  revalidatePath("/my-trails");
  revalidatePath("/logbook");
  revalidatePath("/map");
  redirect("/my-trails");
}
