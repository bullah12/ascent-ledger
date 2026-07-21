import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { CLIMB_CONDITIONS, CLIMB_VARIANTS } from "@/lib/climbs/validation";

export const reviewInputSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a rating from 1 to 5").max(5),
  text: z.string().trim().max(2000, "Review is too long").optional(),
  climbedOn: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.iso.date({ error: "Climbed-on date must be a valid date" }).optional()
  ),
  variant: z.enum(CLIMB_VARIANTS).optional(),
  conditions: z.array(z.enum(CLIMB_CONDITIONS)).max(CLIMB_CONDITIONS.length).default([]),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

export async function deleteReviewForOwner(
  tx: Prisma.TransactionClient,
  routeId: string,
  userId: string
) {
  return tx.routeReview.deleteMany({ where: { routeId, userId } });
}

export async function recomputeReviewAggregate(
  tx: Prisma.TransactionClient,
  routeId: string
) {
  const aggregate = await tx.routeReview.aggregate({
    where: { routeId },
    _count: { _all: true },
    _avg: { rating: true },
  });
  const values = {
    reviewCount: aggregate._count._all,
    avgRating: aggregate._avg.rating,
  };
  await tx.route.update({ where: { id: routeId }, data: values });
  return values;
}

/** Serializable + retry prevents concurrent review mutations from leaving a
 * stale cached count/average. */
export async function mutateReviewAndRecompute(
  prisma: PrismaClient,
  routeId: string,
  mutation: (tx: Prisma.TransactionClient) => Promise<void>
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await mutation(tx);
          return recomputeReviewAggregate(tx, routeId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error("Review transaction did not complete");
}
