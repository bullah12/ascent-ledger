import { prisma } from "@/lib/prisma";

// Find-or-create an Area from a free-text name (Phase 1: name only;
// region/coords fill in from Phase 3 route data). Returns null for blank.
export async function resolveAreaId(
  name: string | undefined
): Promise<string | null> {
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
