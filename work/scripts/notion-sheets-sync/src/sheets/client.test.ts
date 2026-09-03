import { describe, it, expect } from "vitest";
import { columnLetterFor, isNonDefaultFill, rowsToAppendFor } from "./client.ts";

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

describe("rowsToAppendFor", () => {
  it("appends nothing when the grid already fits the needed rows", () => {
    expect(rowsToAppendFor(159, 159)).toBe(0);
    expect(rowsToAppendFor(1000, 200)).toBe(0);
  });

  it("covers the shortfall plus headroom when the grid is too small", () => {
    expect(rowsToAppendFor(159, 166)).toBe(17);
    expect(rowsToAppendFor(159, 160)).toBe(11);
  });
});

describe("isNonDefaultFill", () => {
  it("treats explicit white (1,1,1) as default", () => {
    expect(isNonDefaultFill({ red: 1, green: 1, blue: 1 })).toBe(false);
  });

  it("treats undefined as default", () => {
    expect(isNonDefaultFill(undefined)).toBe(false);
  });

  it("detects any channel below 1 as styled", () => {
    expect(isNonDefaultFill({ red: 0.8, green: 0.5, blue: 1 })).toBe(true);
    expect(isNonDefaultFill({ red: 1, green: 1, blue: 0.99 })).toBe(true);
    expect(isNonDefaultFill({ red: 0, green: 0, blue: 0 })).toBe(true);
  });
});
