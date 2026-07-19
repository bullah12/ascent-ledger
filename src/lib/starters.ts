import type { PrismaClient } from "@/generated/prisma/client";
import type { Discipline } from "@/generated/prisma/enums";
import { normaliseText } from "@/lib/matching";

export type StarterRoute = {
  id: string;
  name: string;
  discipline: Discipline;
  gradeRaw: string | null;
  lengthM: number | null;
  area: { name: string; region: string | null; country: string | null } | null;
};

export type StarterPack = {
  discipline: Discipline;
  region: string;
  routes: StarterRoute[];
  homeRegionMatch: boolean;
};

export function buildStarterPacks(
  routes: StarterRoute[],
  homeRegion: string | null
): StarterPack[] {
  const groups = new Map<string, StarterPack>();
  const home = normaliseText(homeRegion ?? "");
  for (const route of routes) {
    const region = route.area?.region ?? route.area?.country ?? "Other regions";
    const key = `${route.discipline}:${normaliseText(region)}`;
    const regionKey = normaliseText(
      [region, route.area?.country, route.area?.name].filter(Boolean).join(" ")
    );
    const pack = groups.get(key) ?? {
      discipline: route.discipline,
      region,
      routes: [],
      homeRegionMatch: Boolean(home && (regionKey.includes(home) || home.includes(normaliseText(region)))),
    };
    pack.routes.push(route);
    groups.set(key, pack);
  }
  return [...groups.values()]
    .map((pack) => ({ ...pack, routes: pack.routes.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort(
      (a, b) =>
        Number(b.homeRegionMatch) - Number(a.homeRegionMatch) ||
        a.region.localeCompare(b.region) ||
        a.discipline.localeCompare(b.discipline)
    );
}

export async function getStarterPacks(
  prisma: PrismaClient,
  preference: { preferredDisciplines: Discipline[]; homeRegion: string | null }
): Promise<StarterPack[]> {
  const routes = await prisma.route.findMany({
    where:
      preference.preferredDisciplines.length > 0
        ? { starterDisciplines: { hasSome: preference.preferredDisciplines } }
        : { starterDisciplines: { isEmpty: false } },
    select: {
      id: true,
      name: true,
      discipline: true,
      gradeRaw: true,
      lengthM: true,
      area: { select: { name: true, region: true, country: true } },
    },
    orderBy: { name: "asc" },
  });
  return buildStarterPacks(routes, preference.homeRegion);
}
