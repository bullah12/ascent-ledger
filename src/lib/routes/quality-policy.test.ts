import { describe, expect, it } from "vitest";
import type { ExternalRoute } from "@/lib/importers/types";
import {
  APPROVED_PUBLIC_ROUTE_WHERE,
  evaluateImportedRoute,
  routeInputFingerprint,
} from "./quality-policy";

const route = (overrides: Partial<ExternalRoute> = {}): ExternalRoute => ({
  externalId: "relation/1", externalUrl: "https://www.openstreetmap.org/relation/1",
  name: "Authority Trail", discipline: "hiking", gradeSystem: null, gradeRaw: null,
  lat: null, lng: null, lengthM: null, calculatedLengthM: 12_000,
  pitches: null, description: null, qualityRating: null,
  pathGeojson: { type: "LineString", coordinates: [[0, 0], [0.1, 0.1]] },
  geometryCompleteness: "complete", area: null, ...overrides,
});

describe("official route quality policy", () => {
  it("approves a usable route from an explicitly allowlisted official agency", () => {
    expect(evaluateImportedRoute("national_trails_england", route({ externalId: "1" }))).toMatchObject({
      state: "approved", verificationStatus: "verified", qualityScore: 100,
      reasons: ["OFFICIAL_AGENCY_ALLOWLIST"],
    });
  });

  it("approves an OSM route relation only with convincing network authority", () => {
    const decision = evaluateImportedRoute("osm_geofabrik", route({
      network: "nwn", officialRef: "NT-7", operator: "National Trails Agency",
      rawMetadata: { tags: { type: "route", route: "hiking", network: "nwn", ref: "NT-7", operator: "National Trails Agency" } },
    }));
    expect(decision).toMatchObject({ state: "approved", verificationStatus: "verified" });
    expect(decision.qualityScore).toBeGreaterThanOrEqual(70);
  });

  it("quarantines a named OSM relation when identity and authority signals are weak", () => {
    expect(evaluateImportedRoute("osm_geofabrik", route({ rawMetadata: { tags: { type: "route", route: "hiking", name: "A Walk" } } }))).toMatchObject({
      state: "quarantined", reasons: ["INSUFFICIENT_OFFICIAL_SIGNALS"],
    });
  });

  it("rejects standalone ways, unnamed fragments, and commute-like records", () => {
    expect(evaluateImportedRoute("osm_geofabrik", route({ externalId: "way/2", rawMetadata: { tags: { name: "Way" } } })).reasons).toContain("OSM_STANDALONE_WAY");
    expect(evaluateImportedRoute("osm_geofabrik", route({ name: " " })).reasons).toContain("UNNAMED_RECORD");
    expect(evaluateImportedRoute("osm_geofabrik", route({
      name: "Home to work", network: "lwn", officialRef: "X",
      rawMetadata: { tags: { type: "route", route: "hiking", network: "lwn", ref: "X" } },
    })).reasons).toContain("RESIDENTIAL_OR_COMMUTE_LIKE");
  });

  it("rejects implausibly short and fragmented geometry", () => {
    expect(evaluateImportedRoute("osm_geofabrik", route({ calculatedLengthM: 120, rawMetadata: { tags: { type: "route", route: "hiking", network: "nwn", ref: "1" } } })).reasons).toContain("IMPLAUSIBLY_SHORT");
    expect(evaluateImportedRoute("osm_geofabrik", route({ geometryCompleteness: "clipped", rawMetadata: { tags: { type: "route", route: "hiking", network: "nwn", ref: "1" } } })).reasons).toContain("UNUSABLE_GEOMETRY");
  });

  it("does not auto-publish a community source without manual verification", () => {
    expect(evaluateImportedRoute("camptocamp", route({ externalId: "123" }))).toMatchObject({ state: "pending_review", verificationStatus: "unverified" });
  });

  it("uses a deterministic input fingerprint and one shared public predicate", () => {
    const first = routeInputFingerprint("osm_geofabrik", route({ rawMetadata: { b: 2, a: 1 } }));
    const second = routeInputFingerprint("osm_geofabrik", route({ rawMetadata: { a: 1, b: 2 } }));
    expect(first).toBe(second);
    expect(APPROVED_PUBLIC_ROUTE_WHERE).toEqual({ origin: "imported", publicationState: "approved", verificationStatus: "verified" });
  });
});
