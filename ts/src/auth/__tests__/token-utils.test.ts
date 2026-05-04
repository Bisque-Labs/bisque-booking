import { describe, it, expect } from "vitest";
import { generateToken, slugify } from "../token-utils";

describe("generateToken()", () => {
  it("generates a non-empty string", () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThan(0);
  });

  it("generates URL-safe tokens (no +, /, =)", () => {
    for (let i = 0; i < 20; i++) {
      const token = generateToken(32);
      expect(token).not.toMatch(/[+/=]/);
    }
  });

  it("generates different tokens each call", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });

  it("respects the length parameter (longer input = longer output)", () => {
    const short = generateToken(8);
    const long = generateToken(64);
    expect(long.length).toBeGreaterThan(short.length);
  });
});

describe("slugify()", () => {
  it("lowercases and trims", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("John Doe")).toBe("john-doe");
  });

  it("removes special characters", () => {
    expect(slugify("Alice (O'Brien)")).toBe("alice-obrien");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  it("strips leading/trailing hyphens", () => {
    expect(slugify("-foo-")).toBe("foo");
  });

  it("truncates to 32 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(32);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});
