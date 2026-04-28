import { describe, it, expect } from "vitest";
import {
  currentMonthLabel,
  firstInstantOfMonth,
  kpiWindowStart,
  lastInstantOfMonth,
  monthLabelFromIsoString,
  monthLabelToDate,
  previousMonthLabel,
} from "./month.ts";

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

describe("monthLabelToDate", () => {
  it("round-trips through currentMonthLabel for a variety of months", () => {
    const labels = ["1/2026", "3/2026", "4/2026", "12/2025", "7/2024"];
    for (const label of labels) {
      expect(currentMonthLabel(monthLabelToDate(label))).toBe(label);
    }
  });

  it("lands safely inside the target month when converted to Vietnam time", () => {
    const date = monthLabelToDate("3/2026");
    const vietnamDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    expect(vietnamDate.getUTCFullYear()).toBe(2026);
    expect(vietnamDate.getUTCMonth()).toBe(2);
  });

  it("throws on a malformed label", () => {
    expect(() => monthLabelToDate("March 2026")).toThrow(/bad label/);
  });

  it("throws when the month is out of 1..12", () => {
    expect(() => monthLabelToDate("0/2026")).toThrow(/out of range/);
    expect(() => monthLabelToDate("13/2026")).toThrow(/out of range/);
  });
});

describe("firstInstantOfMonth", () => {
  it("returns 00:00 Vietnam time on the first day of the target month", () => {
    const first = firstInstantOfMonth("4/2026");
    expect(first.toISOString()).toBe("2026-03-31T17:00:00.000Z");
  });

  it("round-trips through currentMonthLabel", () => {
    expect(currentMonthLabel(firstInstantOfMonth("4/2026"))).toBe("4/2026");
    expect(currentMonthLabel(firstInstantOfMonth("1/2026"))).toBe("1/2026");
  });

  it("throws on a malformed label", () => {
    expect(() => firstInstantOfMonth("April 2026")).toThrow(/bad label/);
  });
});

describe("kpiWindowStart", () => {
  it("returns day 10 of the month before the target", () => {
    expect(kpiWindowStart("4/2026").toISOString()).toBe("2026-03-09T17:00:00.000Z");
    expect(kpiWindowStart("5/2026").toISOString()).toBe("2026-04-09T17:00:00.000Z");
    expect(kpiWindowStart("3/2026").toISOString()).toBe("2026-02-09T17:00:00.000Z");
  });

  it("crosses year boundary backwards", () => {
    expect(kpiWindowStart("1/2026").toISOString()).toBe("2025-12-09T17:00:00.000Z");
  });

  it("returns midnight Vietnam time on day 10", () => {
    const start = kpiWindowStart("4/2026");
    expect(currentMonthLabel(start)).toBe("3/2026");
  });
});

describe("lastInstantOfMonth", () => {
  it("returns 23:59:59.999 Vietnam time on the last day of the target month", () => {
    const last = lastInstantOfMonth("4/2026");
    expect(last.toISOString()).toBe("2026-04-30T16:59:59.999Z");
  });

  it("wraps into the next year at December", () => {
    const last = lastInstantOfMonth("12/2025");
    expect(last.toISOString()).toBe("2025-12-31T16:59:59.999Z");
    expect(currentMonthLabel(last)).toBe("12/2025");
  });

  it("throws on a malformed label", () => {
    expect(() => lastInstantOfMonth("April 2026")).toThrow(/bad label/);
  });
});
