import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ROUTE_QUALITY_POLICY_VERSION } from "@/lib/routes/quality-policy";

export function listQuarantinedRoutes(prisma: PrismaClient, take = 100) {
  return prisma.route.findMany({
    where: { publicationState: { in: ["quarantined", "pending_review"] } },
    select: {
      id: true, name: true, discipline: true, publicationState: true,
      qualityScore: true, qualitySignalsJson: true, moderationReason: true,
      sourceAuthority: true,
      moderationLocked: true,
      sourceRecords: { select: { source: true, externalId: true, externalUrl: true, decisionReasons: true, qualitySignalsJson: true } },
    },
    orderBy: [{ qualityScore: "desc" }, { updatedAt: "asc" }],
    take: Math.max(1, Math.min(take, 500)),
  });
}

export async function moderateRoute(
  prisma: PrismaClient,
  input: { routeId: string; actorUserId?: string; decision: "approved" | "rejected"; reason: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 8) throw new Error("A meaningful moderation reason is required");
  return prisma.$transaction(async (tx) => {
    const route = await tx.route.findUnique({ where: { id: input.routeId }, select: { origin: true, publicationState: true, qualityScore: true, qualitySignalsJson: true } });
    if (!route) throw new Error("Route not found");
    if (input.decision === "approved" && route.origin !== "imported") throw new Error("Legacy user-created routes cannot be promoted into the canonical catalogue");
    await tx.route.update({ where: { id: input.routeId }, data: {
      publicationState: input.decision,
      verificationStatus: input.decision === "approved" ? "verified" : "failed",
      verificationReason: reason, moderationReason: reason,
      moderatedAt: new Date(), policyVersion: ROUTE_QUALITY_POLICY_VERSION,
      moderationLocked: true,
    } });
    await tx.routeModerationEvent.create({ data: {
      routeId: input.routeId, actorUserId: input.actorUserId,
      action: input.decision === "approved" ? "approved" : "rejected",
      fromState: route.publicationState, toState: input.decision, reason,
      policyVersion: ROUTE_QUALITY_POLICY_VERSION, qualityScore: route.qualityScore,
      signalsJson: route.qualitySignalsJson as Prisma.InputJsonValue ?? undefined,
    } });
    return { id: input.routeId, publicationState: input.decision };
  });
}
