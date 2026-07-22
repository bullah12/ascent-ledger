import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ExternalRoute } from "@/lib/importers/types";

export const ROUTE_QUALITY_POLICY_VERSION = "route-quality-v1";

export const OFFICIAL_AGENCY_SOURCES = new Map<string, string>([
  ["national_trails_england", "Natural England"],
  ["national_trails_wales", "Natural Resources Wales"],
  ["nature_scot_great_trails", "NatureScot"],
  ["england_coast_path", "Natural England"],
  ["sweden_naturvardsverket", "Naturvårdsverket"],
  ["finland_lipas", "LIPAS / University of Jyväskylä"],
  ["norway_kartverket_trails", "Kartverket"],
  ["swiss_wanderland", "Federal Office of Topography swisstopo"],
  ["france_datatourisme", "DATAtourisme producer network"],
]);

export const RECOGNISED_OSM_NETWORKS = new Set([
  "iwn", "nwn", "rwn", "lwn",
]);

const PUBLIC_DISCIPLINES = new Set([
  "rock", "winter", "alpine", "ski_touring", "via_ferrata", "hiking",
]);
const RESIDENTIAL_NAME = /\b(home|house|commute|commuting|school run|to work|work to|daily walk|dog walk)\b/i;
const MIN_AGENCY_GEOMETRY_M = 100;
const MIN_OSM_GEOMETRY_M = 500;

export type RoutePolicyState = "approved" | "quarantined" | "rejected" | "pending_review";
export type RoutePolicyDecision = {
  state: RoutePolicyState;
  verificationStatus: "verified" | "unverified" | "failed";
  qualityScore: number;
  reasons: string[];
  signals: Record<string, boolean | number | string | null>;
  sourceAuthority: string | null;
  policyVersion: typeof ROUTE_QUALITY_POLICY_VERSION;
  inputFingerprint: string;
};

type PolicyRoute = Pick<ExternalRoute,
  "externalId" | "name" | "discipline" | "lengthM" | "calculatedLengthM" |
  "pathGeojson" | "geometryCompleteness" | "officialRef" | "network" |
  "operator" | "wikidata" | "website" | "externalUrl" | "rawMetadata"
>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function routeInputFingerprint(source: string, route: PolicyRoute): string {
  return createHash("sha256").update(JSON.stringify(stable({
    source,
    externalId: route.externalId,
    name: route.name,
    discipline: route.discipline,
    lengthM: route.lengthM,
    calculatedLengthM: route.calculatedLengthM,
    geometryCompleteness: route.geometryCompleteness,
    officialRef: route.officialRef,
    network: route.network,
    operator: route.operator,
    wikidata: route.wikidata,
    website: route.website,
    externalUrl: route.externalUrl,
    rawMetadata: route.rawMetadata,
    coordinates: route.pathGeojson?.coordinates,
  }))).digest("hex");
}

function osmTags(route: PolicyRoute): Record<string, string> {
  const raw = route.rawMetadata as { tags?: unknown } | undefined;
  if (!raw?.tags || typeof raw.tags !== "object") return {};
  return Object.fromEntries(Object.entries(raw.tags as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function geometryLength(route: PolicyRoute) {
  return route.lengthM ?? route.calculatedLengthM ?? 0;
}

function finish(
  source: string,
  route: PolicyRoute,
  values: Omit<RoutePolicyDecision, "policyVersion" | "inputFingerprint">,
): RoutePolicyDecision {
  return {
    ...values,
    qualityScore: Math.max(0, Math.min(100, Math.round(values.qualityScore))),
    policyVersion: ROUTE_QUALITY_POLICY_VERSION,
    inputFingerprint: routeInputFingerprint(source, route),
  };
}

/**
 * The only policy that may promote an imported record into the public catalogue.
 * Names contribute very little: authority, identity, source type, and usable
 * geometry are independently required.
 */
export function evaluateImportedRoute(source: string, route: PolicyRoute): RoutePolicyDecision {
  const name = route.name.trim();
  const distanceM = geometryLength(route);
  const hasGeometry = Boolean(route.pathGeojson?.coordinates?.length && distanceM > 0);
  const geometryUsable = hasGeometry && route.geometryCompleteness !== "clipped" && route.geometryCompleteness !== "incomplete";
  const baseSignals = {
    named: Boolean(name),
    supportedDiscipline: PUBLIC_DISCIPLINES.has(route.discipline),
    hasGeometry,
    geometryUsable,
    distanceM,
  };

  if (!name) return finish(source, route, {
    state: "rejected", verificationStatus: "failed", qualityScore: 0,
    reasons: ["UNNAMED_RECORD"], signals: baseSignals, sourceAuthority: null,
  });
  if (!PUBLIC_DISCIPLINES.has(route.discipline)) return finish(source, route, {
    state: "rejected", verificationStatus: "failed", qualityScore: 0,
    reasons: ["UNSUPPORTED_ACTIVITY"], signals: baseSignals, sourceAuthority: null,
  });

  const agency = OFFICIAL_AGENCY_SOURCES.get(source);
  if (agency) {
    if (!geometryUsable) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 25,
      reasons: ["UNUSABLE_GEOMETRY"], signals: { ...baseSignals, agencyAllowlisted: true }, sourceAuthority: agency,
    });
    if (distanceM < MIN_AGENCY_GEOMETRY_M) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 35,
      reasons: ["IMPLAUSIBLY_SHORT"], signals: { ...baseSignals, agencyAllowlisted: true }, sourceAuthority: agency,
    });
    return finish(source, route, {
      state: "approved", verificationStatus: "verified", qualityScore: 100,
      reasons: ["OFFICIAL_AGENCY_ALLOWLIST"],
      signals: { ...baseSignals, agencyAllowlisted: true }, sourceAuthority: agency,
    });
  }

  if (source === "osm_geofabrik" || source === "osm_overpass") {
    const tags = osmTags(route);
    const isRelation = route.externalId.startsWith("relation/");
    const routeType = tags.type === "route";
    const acceptedRouteActivity = /^(hiking|foot)$/.test(tags.route ?? "");
    const recognisedNetwork = RECOGNISED_OSM_NETWORKS.has((route.network ?? tags.network ?? "").toLowerCase());
    const authoritySignals = [
      Boolean(route.officialRef ?? tags.ref),
      Boolean(route.operator ?? tags.operator),
      Boolean(tags["osmc:symbol"]),
      Boolean(route.website ?? tags.website),
      Boolean(route.wikidata ?? tags.wikidata ?? tags.wikipedia),
    ].filter(Boolean).length;
    const residentialLooking = RESIDENTIAL_NAME.test(name) || tags.highway === "residential";
    const signals = {
      ...baseSignals, isRelation, routeType, acceptedRouteActivity,
      recognisedNetwork, authoritySignals, residentialLooking,
      hasOfficialRef: Boolean(route.officialRef ?? tags.ref),
      hasOperator: Boolean(route.operator ?? tags.operator),
      hasMaintainedSymbol: Boolean(tags["osmc:symbol"]),
      hasOfficialWebsite: Boolean(route.website ?? tags.website),
      hasKnowledgeIdentity: Boolean(route.wikidata ?? tags.wikidata ?? tags.wikipedia),
    };

    if (!isRelation) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 0,
      reasons: ["OSM_STANDALONE_WAY"], signals, sourceAuthority: null,
    });
    if (!routeType || !acceptedRouteActivity) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 10,
      reasons: ["OSM_NOT_SUPPORTED_ROUTE_RELATION"], signals, sourceAuthority: null,
    });
    if (!geometryUsable) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 20,
      reasons: ["UNUSABLE_GEOMETRY"], signals, sourceAuthority: null,
    });
    if (distanceM < MIN_OSM_GEOMETRY_M) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 25,
      reasons: ["IMPLAUSIBLY_SHORT"], signals, sourceAuthority: null,
    });
    if (residentialLooking && authoritySignals < 3) return finish(source, route, {
      state: "rejected", verificationStatus: "failed", qualityScore: 20,
      reasons: ["RESIDENTIAL_OR_COMMUTE_LIKE"], signals, sourceAuthority: null,
    });

    const score = 30 + (recognisedNetwork ? 25 : 0) + Math.min(35, authoritySignals * 10) + (geometryUsable ? 10 : 0);
    const convincingAuthority = recognisedNetwork ? authoritySignals >= 1 : authoritySignals >= 3;
    if (score >= 70 && convincingAuthority) return finish(source, route, {
      state: "approved", verificationStatus: "verified", qualityScore: score,
      reasons: ["QUALIFYING_OSM_ROUTE_RELATION"], signals,
      sourceAuthority: route.operator ?? tags.operator ?? route.network ?? tags.network ?? "OSM route relation metadata",
    });
    return finish(source, route, {
      state: "quarantined", verificationStatus: "unverified", qualityScore: score,
      reasons: ["INSUFFICIENT_OFFICIAL_SIGNALS"], signals, sourceAuthority: route.operator ?? tags.operator ?? null,
    });
  }

  return finish(source, route, {
    state: "pending_review", verificationStatus: "unverified", qualityScore: geometryUsable ? 45 : 20,
    reasons: ["SOURCE_REQUIRES_MANUAL_VERIFICATION"], signals: baseSignals, sourceAuthority: route.operator ?? null,
  });
}

export const APPROVED_PUBLIC_ROUTE_WHERE = {
  origin: "imported",
  publicationState: "approved",
  verificationStatus: "verified",
} as const satisfies Prisma.RouteWhereInput;

export function isApprovedPublicRoute(route: {
  origin: string;
  publicationState: string;
  verificationStatus: string;
}) {
  return route.origin === "imported" && route.publicationState === "approved" && route.verificationStatus === "verified";
}
