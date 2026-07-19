"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  mutateReviewAndRecompute,
  reviewInputSchema,
  deleteReviewForOwner,
} from "@/lib/community/reviews";

export type ReviewFormState = { error?: string; saved?: boolean };

export async function saveReview(
  routeId: string,
  _state: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
  const user = await requireUser();
  const parsed = reviewInputSchema.safeParse({
    rating: formData.get("rating"),
    text: formData.get("text") || undefined,
    climbedOn: formData.get("climbedOn") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const route = await prisma.route.findUnique({ where: { id: routeId }, select: { id: true } });
  if (!route) return { error: "Route not found" };

  try {
    await mutateReviewAndRecompute(prisma, routeId, async (tx) => {
      await tx.routeReview.upsert({
        where: { routeId_userId: { routeId, userId: user.id } },
        update: {
          rating: parsed.data.rating,
          text: parsed.data.text || null,
          climbedOn: parsed.data.climbedOn ? new Date(parsed.data.climbedOn) : null,
        },
        create: {
          routeId,
          userId: user.id,
          rating: parsed.data.rating,
          text: parsed.data.text || null,
          climbedOn: parsed.data.climbedOn ? new Date(parsed.data.climbedOn) : null,
        },
      });
    });
  } catch {
    return { error: "Could not save the review. Please try again." };
  }
  revalidatePath(`/routes/${routeId}`);
  return { saved: true };
}

export async function deleteOwnReview(routeId: string): Promise<void> {
  const user = await requireUser();
  await mutateReviewAndRecompute(prisma, routeId, async (tx) => {
    await deleteReviewForOwner(tx, routeId, user.id);
  });
  revalidatePath(`/routes/${routeId}`);
}

export async function toggleRouteTag(formData: FormData): Promise<void> {
  const user = await requireUser();
  const routeId = formData.get("routeId");
  const slug = formData.get("slug");
  const selected = formData.get("selected") === "true";
  if (typeof routeId !== "string" || typeof slug !== "string") return;
  const [route, tag] = await Promise.all([
    prisma.route.findUnique({ where: { id: routeId }, select: { id: true } }),
    prisma.tag.findUnique({ where: { slug }, select: { id: true } }),
  ]);
  if (!route || !tag) return;
  if (selected) {
    await prisma.routeTag.deleteMany({
      where: { routeId, tagId: tag.id, userId: user.id },
    });
  } else {
    await prisma.routeTag.upsert({
      where: { routeId_tagId_userId: { routeId, tagId: tag.id, userId: user.id } },
      update: {},
      create: { routeId, tagId: tag.id, userId: user.id },
    });
  }
  revalidatePath(`/routes/${routeId}`);
}
