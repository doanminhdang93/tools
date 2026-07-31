import { describe, expect, it } from "vitest";
import { needsDoneDateRestamp } from "./done-date.ts";

describe("needsDoneDateRestamp", () => {
  it("writes when the field is empty", () => {
    expect(needsDoneDateRestamp("", "2026-07-31")).toBe(true);
  });

  it("writes when the existing date belongs to another month", () => {
    expect(needsDoneDateRestamp("2026-07-30", "2026-06-30")).toBe(true);
    expect(needsDoneDateRestamp("2026-07-30T17:16:00.000+07:00", "2026-06-30")).toBe(true);
    expect(needsDoneDateRestamp("2025-06-30", "2026-06-30")).toBe(true);
  });

  it("leaves a date that already sits in the section's month", () => {
    expect(needsDoneDateRestamp("2026-06-30", "2026-06-30")).toBe(false);
    // A hand-entered mid-month date is inside the right month — don't churn it.
    expect(needsDoneDateRestamp("2026-06-15", "2026-06-30")).toBe(false);
    expect(needsDoneDateRestamp("2026-07-09T10:00:00.000+07:00", "2026-07-31")).toBe(false);
  });
});
