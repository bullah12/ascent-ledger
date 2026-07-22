import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { parseReclassificationArgs, reclassifyRoutes } from "./reclassify-routes";

describe("existing route reclassification", () => {
  it("is dry-run by default and enforces bounded resumable arguments", () => {
    expect(parseReclassificationArgs(["--batch=50", "--batches=2", "--after=abc"]))
      .toEqual({ apply: false, batch: 50, batches: 2, after: "abc" });
    expect(() => parseReclassificationArgs(["--batch=0"])).toThrow("--batch");
  });

  it("classifies existing source records without writing in dry-run mode", async () => {
    const update = () => { throw new Error("dry-run attempted a write"); };
    const fakePrisma = {
      route: { findMany: async () => [{
        id: "route-1", name: "Pennine Way", discipline: "hiking",
        origin: "imported", publicationState: "pending_review", policyVersion: null,
        qualityScore: 0, calculatedLengthM: 5_000, officialRef: null, network: null, operator: null,
        sourceRecords: [{ id: "source-1", source: "national_trails_england", externalId: "1",
          externalUrl: "https://official.invalid/1", sourceName: "Pennine Way", sourceDistanceM: 5_000,
          sourceAscentM: null, sourceDescentM: null, geometryGeojson: { type: "LineString", coordinates: [[0, 0], [0.1, 0.1]] },
          geometryCompleteness: "complete", rawMetadataJson: {},
        }],
      }] },
      routeSourceRecord: { update }, routeModerationEvent: { create: update },
    } as unknown as PrismaClient;
    const report = await reclassifyRoutes(fakePrisma, { apply: false, batch: 20, batches: 1 });
    expect(report).toMatchObject({ mode: "dry-run", processed: 1, nextCursor: "route-1", byState: { approved: 1 }, bySource: { national_trails_england: 1 } });
  });
});
