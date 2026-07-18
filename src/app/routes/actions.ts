"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAreaId } from "@/lib/areas";
import { normaliseGrade } from "@/lib/grades";
import { routeInputSchema, type RouteInput } from "@/lib/routes/validation";

export type RouteFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof RouteInput, string>>;
};

export async function createRoute(
  _prev: RouteFormState,
  formData: FormData
): Promise<RouteFormState> {
  await requireUser();

  const result = routeInputSchema.safeParse({
    name: formData.get("name"),
    discipline: formData.get("discipline"),
    gradeSystem: formData.get("gradeSystem"),
    gradeRaw: formData.get("gradeRaw") ?? undefined,
    area: formData.get("area") ?? undefined,
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    description: formData.get("description") ?? undefined,
  });

  if (!result.success) {
    const fieldErrors: RouteFormState["fieldErrors"] = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof RouteInput | undefined;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const input = result.data;

  try {
    const areaId = await resolveAreaId(input.area);
    await prisma.route.create({
      data: {
        name: input.name,
        discipline: input.discipline,
        gradeSystem: input.gradeRaw ? input.gradeSystem : null,
        gradeRaw: input.gradeRaw || null,
        gradeNormalisedScore: input.gradeRaw
          ? normaliseGrade(input.gradeSystem, input.gradeRaw)
          : null,
        areaId,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        description: input.description || null,
        externalSource: "manual",
      },
    });
  } catch {
    return { error: "Could not save the route. Please try again." };
  }

  revalidatePath("/routes");
  redirect("/routes");
}
