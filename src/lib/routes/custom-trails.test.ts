import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ownedCustomTrailWhere } from "./custom-trails";

describe("private custom-trail ownership", () => {
  it("always scopes service-role lookups to the authenticated owner", () => {
    expect(ownedCustomTrailWhere("user-a", "trail-1")).toEqual({ ownerId: "user-a", id: "trail-1" });
    expect(ownedCustomTrailWhere("user-b", "trail-1")).not.toEqual(ownedCustomTrailWhere("user-a", "trail-1"));
  });

  it("adds RLS CRUD policies and a cross-user climb-link trigger", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260722120000_route_quality_and_custom_trails/migration.sql"), "utf8");
    expect(sql).toContain('ALTER TABLE "ascent_ledger"."custom_trails" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY "custom_trails_owner_select"');
    expect(sql).toContain('CREATE POLICY "custom_trails_owner_update"');
    expect(sql).toContain('enforce_custom_trail_climb_owner');
    expect(sql).toContain('climbs_custom_trail_private_check');
  });

  it("filters database-level public surfaces to approved canonical imports", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260722120000_route_quality_and_custom_trails/migration.sql"), "utf8");
    expect(sql).toContain('CREATE POLICY "routes_approved_public_read"');
    expect(sql).toContain("r.publication_state = 'approved'");
    expect(sql).toContain("r.verification_status = 'verified'");
  });
});
