import type { Prisma } from "@/generated/prisma/client";

/** Every service-role custom-trail query must include this owner boundary. */
export function ownedCustomTrailWhere(ownerId: string, id?: string): Prisma.CustomTrailWhereInput {
  return { ownerId, ...(id ? { id } : {}) };
}
