import { describe, it, expect } from "vitest";
import {
  isSyncableStatus,
  moneyFormulaForRole,
  SYNCABLE_STATUSES,
  tieredMoneyForPoints,
  toSheetApp,
  toSheetStatus,
} from "./constants.ts";

const TIERED_FORMULA = "IF(F6<136,F6*22000,IF(F6<188,136*22000+(F6-136)*30000,136*22000+52*30000+(F6-188)*35000))";

describe("isSyncableStatus", () => {
  it("accepts the canonical Notion casing", () => {
    for (const canonical of SYNCABLE_STATUSES) {
      expect(isSyncableStatus(canonical)).toBe(true);
    }
  });

  it("accepts mismatched casing", () => {
    expect(isSyncableStatus("done")).toBe(true);
    expect(isSyncableStatus("DONE")).toBe(true);
    expect(isSyncableStatus("testing PRO")).toBe(true);
    expect(isSyncableStatus("waiting to test")).toBe(true);
    expect(isSyncableStatus("WAIT TO REVIEW")).toBe(true);
    expect(isSyncableStatus("wait to live")).toBe(true);
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(isSyncableStatus("  Done  ")).toBe(true);
    expect(isSyncableStatus("\tTesting\n")).toBe(true);
  });

  it("rejects statuses that are not in the whitelist", () => {
    expect(isSyncableStatus("To do")).toBe(false);
    expect(isSyncableStatus("Doing")).toBe(false);
    expect(isSyncableStatus("Archived")).toBe(false);
    expect(isSyncableStatus("")).toBe(false);
  });
});

describe("toSheetStatus", () => {
  it("passes through when Notion and Sheet casings match", () => {
    expect(toSheetStatus("Done")).toBe("Done");
    expect(toSheetStatus("Testing")).toBe("Testing");
    expect(toSheetStatus("Reviewing")).toBe("Reviewing");
    expect(toSheetStatus("Waiting To Test")).toBe("Waiting To Test");
    expect(toSheetStatus("Testing Pro")).toBe("Testing Pro");
  });

  it("rewrites 'Wait To Review' (Notion) to 'Wait to Review' (Sheet)", () => {
    expect(toSheetStatus("Wait To Review")).toBe("Wait to Review");
    expect(toSheetStatus("wait to review")).toBe("Wait to Review");
  });

  it("rewrites 'Wait To Live' (Notion) to 'Live' (Sheet)", () => {
    expect(toSheetStatus("Wait To Live")).toBe("Live");
    expect(toSheetStatus("wait to live")).toBe("Live");
  });

  it("returns the raw Notion value for unmapped statuses", () => {
    expect(toSheetStatus("Archived")).toBe("Archived");
  });
});

describe("toSheetApp", () => {
  it("rewrites 'Checkout Upsell' (Notion tag) to 'CKU' (Sheet App)", () => {
    expect(toSheetApp("Checkout Upsell")).toBe("CKU");
    expect(toSheetApp("checkout upsell")).toBe("CKU");
    expect(toSheetApp("  CHECKOUT UPSELL  ")).toBe("CKU");
  });

  it("passes through unmapped tag values unchanged", () => {
    expect(toSheetApp("PPU")).toBe("PPU");
    expect(toSheetApp("CKU")).toBe("CKU");
    expect(toSheetApp("")).toBe("");
  });
});

describe("moneyFormulaForRole — tester", () => {
  it("splits sole-tester vs coassignee using SUMIF on the assignees column", () => {
    const formula = moneyFormulaForRole("tester", "F", 6, { firstTaskRow: 7, lastTaskRow: 20 });
    expect(formula).toBe(
      '=(SUM(F7:F20)-SUMIF(I7:I20,"*,*",F7:F20))*45000+SUMIF(I7:I20,"*,*",F7:F20)*0.3*45000',
    );
  });

  it("falls back to the flat 30% formula when no task range is given", () => {
    expect(moneyFormulaForRole("tester", "F", 6)).toBe("=F6*0.3*45000");
  });
});

describe("moneyFormulaForRole — other roles", () => {
  it("uses 45,000 × point header for developer", () => {
    expect(moneyFormulaForRole("developer", "F", 6)).toBe("=F6*45000");
  });

  it("adds review points for sublead", () => {
    expect(moneyFormulaForRole("sublead", "F", 6)).toBe("=(F6+G6)*45000");
  });

  it("uses the 3-tier formula for designer (same as PO part)", () => {
    expect(moneyFormulaForRole("designer", "F", 6)).toBe(`=${TIERED_FORMULA}`);
  });

  it("uses the 3-tier formula for marketer", () => {
    expect(moneyFormulaForRole("marketer", "F", 6)).toBe(`=${TIERED_FORMULA}`);
  });
});

describe("tieredMoneyForPoints", () => {
  it("tier 1: < 136 → points × 22,000", () => {
    expect(tieredMoneyForPoints(0)).toBe(0);
    expect(tieredMoneyForPoints(100)).toBe(2_200_000);
    expect(tieredMoneyForPoints(135)).toBe(2_970_000);
  });

  it("tier 2: 136..187 → 136×22k + remainder×30k", () => {
    expect(tieredMoneyForPoints(136)).toBe(136 * 22_000);
    expect(tieredMoneyForPoints(150)).toBe(136 * 22_000 + 14 * 30_000);
    expect(tieredMoneyForPoints(187)).toBe(136 * 22_000 + 51 * 30_000);
  });

  it("tier 3: ≥ 188 → 136×22k + 52×30k + remainder×35k", () => {
    expect(tieredMoneyForPoints(188)).toBe(136 * 22_000 + 52 * 30_000);
    expect(tieredMoneyForPoints(200)).toBe(136 * 22_000 + 52 * 30_000 + 12 * 35_000);
  });
});
