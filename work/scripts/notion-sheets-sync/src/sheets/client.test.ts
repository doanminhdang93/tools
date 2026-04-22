import { describe, it, expect } from "vitest";
import { columnLetterFor } from "./client.ts";

describe("columnLetterFor", () => {
  it("maps 1..26 to A..Z", () => {
    expect(columnLetterFor(1)).toBe("A");
    expect(columnLetterFor(2)).toBe("B");
    expect(columnLetterFor(26)).toBe("Z");
  });

  it("maps 27 to AA and 28 to AB", () => {
    expect(columnLetterFor(27)).toBe("AA");
    expect(columnLetterFor(28)).toBe("AB");
  });

  it("maps 52 to AZ and 53 to BA", () => {
    expect(columnLetterFor(52)).toBe("AZ");
    expect(columnLetterFor(53)).toBe("BA");
  });

  it("maps 702 to ZZ and 703 to AAA", () => {
    expect(columnLetterFor(702)).toBe("ZZ");
    expect(columnLetterFor(703)).toBe("AAA");
  });

  it("throws on zero or negative input", () => {
    expect(() => columnLetterFor(0)).toThrow(/>= 1/);
    expect(() => columnLetterFor(-5)).toThrow(/>= 1/);
  });
});
