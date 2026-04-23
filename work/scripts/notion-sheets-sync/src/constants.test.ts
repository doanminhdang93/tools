import { describe, it, expect } from "vitest";
import { isSyncableStatus, SYNCABLE_STATUSES } from "./constants.ts";

describe("isSyncableStatus", () => {
  it("accepts the canonical casing from SYNCABLE_STATUSES", () => {
    for (const canonical of SYNCABLE_STATUSES) {
      expect(isSyncableStatus(canonical)).toBe(true);
    }
  });

  it("accepts mismatched casing (Notion ↔ whitelist)", () => {
    expect(isSyncableStatus("done")).toBe(true);
    expect(isSyncableStatus("DONE")).toBe(true);
    expect(isSyncableStatus("testing PRO")).toBe(true);
    expect(isSyncableStatus("waiting to test")).toBe(true);
    expect(isSyncableStatus("WAIT TO REVIEW")).toBe(true);
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
