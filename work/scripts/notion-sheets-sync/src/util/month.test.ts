import { describe, it, expect } from "vitest";
import { currentMonthLabel, monthLabelFromIsoString, previousMonthLabel } from "./month.ts";

describe("currentMonthLabel", () => {
  it("formats a clear mid-month date in Vietnam time as M/YYYY", () => {
    expect(currentMonthLabel(new Date("2026-04-22T03:00:00Z"))).toBe("4/2026");
    expect(currentMonthLabel(new Date("2025-08-15T00:00:00Z"))).toBe("8/2025");
  });

  it("crosses month boundary at 17:00 UTC (midnight Vietnam time)", () => {
    expect(currentMonthLabel(new Date("2026-03-31T16:59:59Z"))).toBe("3/2026");
    expect(currentMonthLabel(new Date("2026-03-31T17:00:00Z"))).toBe("4/2026");
  });

  it("crosses year boundary correctly in Vietnam time", () => {
    expect(currentMonthLabel(new Date("2025-12-31T16:59:59Z"))).toBe("12/2025");
    expect(currentMonthLabel(new Date("2025-12-31T17:00:00Z"))).toBe("1/2026");
  });
});

describe("monthLabelFromIsoString", () => {
  it("returns M/YYYY in Vietnam time for a clear mid-month ISO timestamp", () => {
    expect(monthLabelFromIsoString("2024-09-04T07:28:00.000Z")).toBe("9/2024");
    expect(monthLabelFromIsoString("2026-01-05T00:00:00Z")).toBe("1/2026");
  });

  it("respects the +7 offset at month boundaries", () => {
    expect(monthLabelFromIsoString("2026-03-31T17:00:00Z")).toBe("4/2026");
    expect(monthLabelFromIsoString("2026-03-31T16:59:59Z")).toBe("3/2026");
  });

  it("throws on invalid input", () => {
    expect(() => monthLabelFromIsoString("not-a-date")).toThrow(/invalid/);
  });
});

describe("previousMonthLabel", () => {
  it("returns the previous month in the same year", () => {
    expect(previousMonthLabel("4/2026")).toBe("3/2026");
    expect(previousMonthLabel("12/2025")).toBe("11/2025");
  });

  it("wraps from January back to December of the prior year", () => {
    expect(previousMonthLabel("1/2026")).toBe("12/2025");
  });

  it("throws on a malformed label", () => {
    expect(() => previousMonthLabel("April 2026")).toThrow(/bad label/);
  });
});
