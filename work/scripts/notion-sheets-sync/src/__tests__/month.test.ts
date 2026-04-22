import { describe, it, expect } from "vitest";
import { currentMonthLabel, monthLabelFromIsoString } from "../month.ts";

describe("currentMonthLabel", () => {
  it("formats a given date as M/YYYY in UTC", () => {
    expect(currentMonthLabel(new Date("2026-04-22T10:00:00Z"))).toBe("4/2026");
    expect(currentMonthLabel(new Date("2025-12-31T23:59:59Z"))).toBe("12/2025");
  });
});

describe("monthLabelFromIsoString", () => {
  it("returns M/YYYY for an ISO timestamp", () => {
    expect(monthLabelFromIsoString("2024-09-04T07:28:00.000Z")).toBe("9/2024");
    expect(monthLabelFromIsoString("2026-01-05T00:00:00Z")).toBe("1/2026");
  });

  it("throws on invalid input", () => {
    expect(() => monthLabelFromIsoString("not-a-date")).toThrow(/invalid/);
  });
});
