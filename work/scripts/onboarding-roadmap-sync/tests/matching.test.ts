import { describe, expect, it } from "vitest";
import { hashContent, normaliseText } from "../src/matching.ts";

describe("normaliseText", () => {
  it("collapses whitespace and trims", () => {
    expect(normaliseText("  a   b\n\nc  ")).toBe("a b c");
  });
});

describe("hashContent", () => {
  it("returns 16 lowercase hex chars", () => {
    const h = hashContent("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across whitespace differences", () => {
    expect(hashContent("hello world")).toBe(hashContent("  hello   world  "));
  });

  it("differs when content differs", () => {
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });
});
