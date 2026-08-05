import { describe, expect, it } from "vitest";
import { failurePath, safeNext } from "./redirect-target";

describe("auth redirect targets", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/reset-password")).toBe("/reset-password");
    expect(safeNext("/logbook?tab=all")).toBe("/logbook?tab=all");
  });

  it("falls back when next is absent", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext(null, "/reset-password")).toBe("/reset-password");
  });

  it("refuses off-site destinations", () => {
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext("evil.example")).toBe("/dashboard");
  });

  it("sends failed recovery links back to the reset request page", () => {
    expect(failurePath("/reset-password")).toMatch(/^\/forgot-password\?error=/);
    expect(failurePath("/dashboard")).toMatch(/^\/sign-in\?error=/);
  });
});
