import type { LineString } from "geojson";
import type { ExternalRoute } from "./types";

export type CanonicalCandidate = {
  id: string;
  name: string;
  discipline: string;
  lat: number | null;
  lng: number | null;
  area?: { name: string; region: string | null; country: string | null } | null;
  pathGeojson?: unknown;
  sourceRecords?: Array<{ externalUrl: string; rawMetadataJson: unknown }>;
};

export type MatchDecision = {
  kind: "merge" | "suggest" | "none";
  candidateId: string | null;
  score: number;
  reasons: string[];
};

export function normalizeRouteName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(the|route|trail|path|way|sentier|chemin|weg)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalizeRouteName(left).split(" ").filter(Boolean));
  const b = new Set(normalizeRouteName(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function line(value: unknown): LineString | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LineString>;
  return candidate.type === "LineString" && Array.isArray(candidate.coordinates) ? candidate as LineString : null;
}

function center(route: Pick<CanonicalCandidate, "lat" | "lng" | "pathGeojson"> | ExternalRoute) {
  if (route.lat !== null && route.lng !== null) return { lat: route.lat, lng: route.lng };
  const geometry = "pathGeojson" in route ? line(route.pathGeojson) : null;
  if (!geometry?.coordinates.length) return null;
  const totals = geometry.coordinates.reduce((sum, coordinate) => ({ lat: sum.lat + coordinate[1], lng: sum.lng + coordinate[0] }), { lat: 0, lng: 0 });
  return { lat: totals.lat / geometry.coordinates.length, lng: totals.lng / geometry.coordinates.length };
}

function collectStrings(value: unknown, keyPattern: RegExp, output: Set<string>) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keyPattern.test(key) && typeof child === "string") output.add(child.trim().toLowerCase());
    else collectStrings(child, keyPattern, output);
  }
}

function crossReferences(route: ExternalRoute) {
  const wikidata = new Set<string>();
  const websites = new Set<string>();
  if (route.wikidata) wikidata.add(route.wikidata.toLowerCase());
  if (route.website) websites.add(route.website.toLowerCase().replace(/\/$/, ""));
  if (route.officialRef) websites.add(`ref:${route.officialRef.toLowerCase()}`);
  return { wikidata, websites };
}

function candidateCrossReferences(candidate: CanonicalCandidate) {
  const wikidata = new Set<string>();
  const websites = new Set<string>();
  for (const record of candidate.sourceRecords ?? []) {
    websites.add(record.externalUrl.toLowerCase().replace(/\/$/, ""));
    collectStrings(record.rawMetadataJson, /wikidata/i, wikidata);
    collectStrings(record.rawMetadataJson, /website|url|ref/i, websites);
  }
  return { wikidata, websites };
}

function intersects(left: Set<string>, right: Set<string>) {
  return [...left].some((value) => right.has(value));
}

export function decideCanonicalMatch(route: ExternalRoute, candidates: CanonicalCandidate[]): MatchDecision {
  let best: MatchDecision = { kind: "none", candidateId: null, score: 0, reasons: [] };
  const incomingRefs = crossReferences(route);
  const incomingCenter = center(route);
  for (const candidate of candidates) {
    if (candidate.discipline !== route.discipline) continue;
    const candidateRefs = candidateCrossReferences(candidate);
    if (intersects(incomingRefs.wikidata, candidateRefs.wikidata) || intersects(incomingRefs.websites, candidateRefs.websites)) {
      return { kind: "merge", candidateId: candidate.id, score: 1, reasons: ["stable cross-reference"] };
    }
    const nameScore = tokenSimilarity(route.name, candidate.name);
    if (nameScore < 0.55) continue;
    const sameCountry = Boolean(route.area?.country && candidate.area?.country && route.area.country.toLowerCase() === candidate.area.country.toLowerCase());
    if (route.area?.country && candidate.area?.country && !sameCountry) continue;
    const sameRegion = Boolean(route.area?.region && candidate.area?.region && route.area.region.toLowerCase() === candidate.area.region.toLowerCase());
    const candidateCenter = center(candidate);
    const separation = incomingCenter && candidateCenter ? distanceM(incomingCenter, candidateCenter) : null;
    const geometryClose = separation !== null && separation <= 2_000;
    let score = nameScore * 0.65 + (sameCountry ? 0.15 : 0) + (sameRegion ? 0.1 : 0) + (geometryClose ? 0.1 : 0);
    score = Math.min(0.99, score);
    const exactName = normalizeRouteName(route.name) === normalizeRouteName(candidate.name);
    const kind = exactName && sameCountry && (geometryClose || sameRegion) && score >= 0.9
      ? "merge"
      : score >= 0.62 ? "suggest" : "none";
    if (score > best.score) {
      best = {
        kind,
        candidateId: kind === "none" ? null : candidate.id,
        score,
        reasons: [exactName ? "normalized name exact" : `name similarity ${nameScore.toFixed(2)}`, sameCountry ? "same country" : "", sameRegion ? "same region" : "", geometryClose ? "geometry centres within 2 km" : ""].filter(Boolean),
      };
    }
  }
  return best;
}

export function shouldApplyImportedField(
  fieldMeta: unknown,
  field: string,
  incomingPrecedence: number
) {
  const meta = fieldMeta && typeof fieldMeta === "object" ? (fieldMeta as Record<string, { precedence?: number; userEdited?: boolean }>) : {};
  const current = meta[field];
  return !current?.userEdited && incomingPrecedence >= (current?.precedence ?? 0);
}
