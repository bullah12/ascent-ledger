import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { ClimbVisibility, TagKind } from "@/generated/prisma/enums";
import { climbInputSchema } from "@/lib/climbs/validation";
import {
  deleteReviewForOwner,
  recomputeReviewAggregate,
  reviewInputSchema,
} from "./reviews";
import { projectPublicTicks } from "./privacy";
import { tagChipsFromCounts } from "./tags";
import tagSeed from "../../../docs/tags.seed.json";

describe("Phase 11 community and privacy", () => {
  it("validates 1–5 ratings and optional review fields", () => {
    expect(reviewInputSchema.safeParse({ rating: 1 }).success).toBe(true);
    expect(reviewInputSchema.safeParse({ rating: 5, text: "Good", climbedOn: "2026-07-01" }).success).toBe(true);
    expect(reviewInputSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ rating: 6 }).success).toBe(false);
  });

  it("recomputes cached review count and average", async () => {
    const update = vi.fn(async () => undefined);
    const tx = {
      routeReview: {
        aggregate: async () => ({ _count: { _all: 3 }, _avg: { rating: 4 } }),
      },
      route: { update },
    } as unknown as Prisma.TransactionClient;
    await expect(recomputeReviewAggregate(tx, "route-1")).resolves.toEqual({
      reviewCount: 3,
      avgRating: 4,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "route-1" },
      data: { reviewCount: 3, avgRating: 4 },
    });
  });

  it("scopes review deletion to its owner", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const tx = { routeReview: { deleteMany } } as unknown as Prisma.TransactionClient;
    await deleteReviewForOwner(tx, "route-1", "user-1");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { routeId: "route-1", userId: "user-1" },
    });
  });

  it("aggregates only positive tag counts and seeds a unique curated vocabulary", () => {
    expect(tagChipsFromCounts([
      { slug: "ridge", label: "Ridge", kind: TagKind.terrain, _count: { routeTags: 2 } },
      { slug: "remote", label: "Remote", kind: TagKind.character, _count: { routeTags: 0 } },
    ])).toEqual([{ slug: "ridge", label: "Ridge", kind: TagKind.terrain, count: 2 }]);
    expect(tagSeed.tags).toHaveLength(30);
    expect(new Set(tagSeed.tags.map((tag) => tag.slug)).size).toBe(30);
    expect(new Set(tagSeed.tags.map((tag) => tag.kind))).toEqual(
      new Set(["terrain", "character", "hazard", "logistics"])
    );
  });

  it("defaults climb visibility to private", () => {
    const parsed = climbInputSchema.parse({
      routeName: "Private climb",
      discipline: "hiking",
      date: "2026-07-19",
      gradeSystem: "sac_hiking",
      gradeRaw: "T2",
      ascentStyle: "solo",
    });
    expect(parsed.visibility).toBe(ClimbVisibility.private);
  });

  it("excludes private climbs and every sensitive field from public tick projections", () => {
    const sensitive = {
      user: { displayName: null, email: "private@example.test", preference: { homeRegion: "Secret" } },
      route: { name: "Public route", pathGeojson: { type: "LineString" } },
      freeTextRouteName: "Private raw name",
      date: new Date("2026-07-10"),
      gradeRaw: "T3",
      ascentStyle: "solo" as const,
      notes: "secret notes",
      partners: ["Private partner"],
      photoUrls: ["secret-photo"],
      gpxTrackUrl: "secret-gpx",
      pathGeojson: { type: "LineString" },
    };
    const projected = projectPublicTicks([
      { ...sensitive, visibility: "private" },
      { ...sensitive, visibility: "public" },
    ]);
    expect(projected).toEqual([{
      displayName: "Ascent Ledger member",
      routeName: "Public route",
      date: "2026-07-10",
      grade: "T3",
      ascentStyle: "solo",
    }]);
    const serialised = JSON.stringify(projected);
    for (const forbidden of [
      "private@example.test", "Secret", "secret notes", "Private partner",
      "secret-photo", "secret-gpx", "pathGeojson",
    ]) expect(serialised).not.toContain(forbidden);
  });

  it("locks uniqueness, safe views, owner policies, and aggregate trigger in forward SQL", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20260719170000_community_v1/migration.sql"),
      "utf8"
    );
    expect(sql).toContain('UNIQUE INDEX "route_reviews_route_id_user_id_key"');
    expect(sql).toContain("CHECK (\"rating\" BETWEEN 1 AND 5)");
    expect(sql).toContain("DEFAULT 'private'");
    expect(sql).toContain('CREATE VIEW "ascent_ledger"."public_ticks"');
    expect(sql).toContain("c.visibility = 'public' AND c.route_id IS NOT NULL");
    expect(sql).toContain('CREATE POLICY "climbs_owner_select"');
    expect(sql).toContain('CREATE TRIGGER "route_reviews_aggregate_trigger"');
    expect(sql).not.toContain('GRANT SELECT ON "ascent_ledger"."climbs" TO anon');
  });
});
