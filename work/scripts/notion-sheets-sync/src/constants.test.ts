import { describe, it, expect } from "vitest";
import { isSyncableStatus, SYNCABLE_STATUSES, toSheetStatus } from "./constants.ts";

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
