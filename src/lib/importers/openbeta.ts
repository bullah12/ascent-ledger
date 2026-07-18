import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import type { ExternalRoute, ImporterOptions, RouteImporter } from "./types";

// OpenBeta (openbeta.io) — open, permissively licensed community climbing
// dataset with a public GraphQL API. Primary source for UK rock routes
// (PLAN.md §5 point 1). We walk the UK area tree breadth-first, collecting
// climbs from leaf crags, capped by options.maxRoutes.
//
// Note: OpenBeta has no UK trad adjectival grade field — climbs carry
// French/UIAA/YDS grades. French/UIAA are stored with their system (their
// ladders are stubs for now, so scores stay null → "ungraded"); YDS-only
// climbs are stored with no system.

const GRAPHQL_ENDPOINT = "https://api.openbeta.io/graphql";
// United Kingdom. As of 2026-07 the UK subtree holds no route data on
// OpenBeta (verified by walking it to exhaustion) — the weekly sync keeps
// checking in case the community fills it in. Override the root via
// OPENBETA_ROOT_UUID to import a different region.
const UK_ROOT_UUID = "ff4fd85d-f006-5be4-97bf-afc87f85ffb3";
const REQUEST_DELAY_MS = 300;

function rootUuid(): string {
  return process.env.OPENBETA_ROOT_UUID || UK_ROOT_UUID;
}

type ObClimb = {
  uuid: string;
  name: string;
  length: number | null;
  metadata: { lat: number | null; lng: number | null } | null;
  grades: { french: string | null; uiaa: string | null; yds: string | null } | null;
  type: { trad: boolean | null; sport: boolean | null; bouldering: boolean | null } | null;
  content: { description: string | null } | null;
};

type ObArea = {
  uuid: string;
  areaName: string;
  pathTokens: string[];
  climbs: ObClimb[];
  children: { uuid: string; totalClimbs: number }[];
};

const AREA_QUERY = `
  query Area($uuid: ID) {
    area(uuid: $uuid) {
      uuid
      areaName: area_name
      pathTokens
      climbs {
        uuid
        name
        length
        metadata { lat lng }
        grades { french uiaa yds }
        type { trad sport bouldering }
        content { description }
      }
      children { uuid totalClimbs }
    }
  }
`;

async function fetchArea(uuid: string): Promise<ObArea | null> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: AREA_QUERY, variables: { uuid } }),
  });
  if (!response.ok) {
    throw new Error(`OpenBeta HTTP ${response.status} for area ${uuid}`);
  }
  const payload = (await response.json()) as {
    data?: { area: ObArea | null };
    errors?: { message: string }[];
  };
  if (payload.errors?.length) {
    throw new Error(`OpenBeta GraphQL error: ${payload.errors[0].message}`);
  }
  return payload.data?.area ?? null;
}

function toExternalRoute(climb: ObClimb, area: ObArea): ExternalRoute | null {
  // BMG rock rules are about routes, not boulder problems.
  if (climb.type?.bouldering && !climb.type?.trad && !climb.type?.sport) {
    return null;
  }

  let gradeSystem: GradeSystem | null = null;
  let gradeRaw: string | null = null;
  if (climb.grades?.french) {
    gradeSystem = GradeSystem.french_sport;
    gradeRaw = climb.grades.french;
  } else if (climb.grades?.uiaa) {
    gradeSystem = GradeSystem.uiaa;
    gradeRaw = climb.grades.uiaa;
  } else if (climb.grades?.yds) {
    gradeRaw = climb.grades.yds;
  }

  // pathTokens is like ["United Kingdom", "England", "Peak District",
  // "Stanage"]; the tokens between country and crag make a decent region.
  const region = area.pathTokens.slice(1, -1).join(" / ") || null;

  return {
    externalId: climb.uuid,
    externalUrl: `https://openbeta.io/climbs/${climb.uuid}`,
    name: climb.name.trim(),
    discipline: Discipline.rock,
    gradeSystem,
    gradeRaw,
    lat: climb.metadata?.lat ?? null,
    lng: climb.metadata?.lng ?? null,
    lengthM: climb.length && climb.length > 0 ? Math.round(climb.length) : null,
    pitches: null,
    description: climb.content?.description?.trim() || null,
    qualityRating: null,
    area: {
      name: area.areaName.trim(),
      region,
      country: area.pathTokens[0] ?? "United Kingdom",
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const openBetaImporter: RouteImporter = {
  source: "openbeta",

  async *fetchRoutes({ maxRoutes, log }: ImporterOptions) {
    // Depth-first so we reach leaf crags (where the climbs are) quickly.
    // totalClimbs is 0 on intermediate areas, so it can't prune the walk;
    // maxRequests bounds API load on sparse subtrees instead.
    const stack: string[] = [rootUuid()];
    const visited = new Set<string>();
    const maxRequests = Math.max(100, maxRoutes * 2);
    let requests = 0;
    let yielded = 0;

    while (stack.length > 0 && yielded < maxRoutes && requests < maxRequests) {
      const uuid = stack.pop()!;
      if (visited.has(uuid)) continue;
      visited.add(uuid);

      requests++;
      const area = await fetchArea(uuid);
      await sleep(REQUEST_DELAY_MS);
      if (!area) continue;

      if (area.climbs.length > 0) {
        log?.(`openbeta: ${area.pathTokens.join(" / ")} — ${area.climbs.length} climbs`);
      }

      for (const climb of area.climbs) {
        if (yielded >= maxRoutes) return;
        const route = toExternalRoute(climb, area);
        if (route) {
          yielded++;
          yield route;
        }
      }

      for (const child of area.children) {
        if (!visited.has(child.uuid)) stack.push(child.uuid);
      }
    }
  },
};
