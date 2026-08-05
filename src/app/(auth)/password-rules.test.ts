import { describe, expect, it } from "vitest";
import {
  describePasswordPairProblem,
  describePasswordProblem,
} from "./password-rules";

describe("password rules", () => {
  it("rejects short passwords", () => {
    expect(describePasswordProblem("ab1")).toMatch(/at least 8/);
  });

  it("requires a letter and a number", () => {
    expect(describePasswordProblem("password")).toMatch(/letter and one number/);
    expect(describePasswordProblem("12345678")).toMatch(/letter and one number/);
  });

  it("accepts a sensible password", () => {
    expect(describePasswordProblem("granite2024")).toBeNull();
  });

  it("reports a mismatch before anything else", () => {
    expect(describePasswordPairProblem("granite2024", "granite2025")).toBe(
      "The two passwords do not match."
    );
  });

  it("still validates matching passwords", () => {
    expect(describePasswordPairProblem("short1", "short1")).toMatch(/at least 8/);
    expect(describePasswordPairProblem("granite2024", "granite2024")).toBeNull();
  });
});
