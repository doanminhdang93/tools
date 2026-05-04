import { describe, it, expect } from "vitest";
import {
  pagesAsReviewer,
  relatedDevTabsForReviewer,
  buildSubleadReviewFormulaFromDevTotals,
  type MemberRoleInfo,
} from "./review-points.ts";
import type { NotionPage } from "./notion/client.ts";

interface PageOptions {
  id: string;
  status?: string;
  createdIso?: string;
  assignees?: string[];
  followers?: string[];
}

function pageWith(options: PageOptions): NotionPage {
  return {
    id: options.id,
    properties: {
      Status: { type: "status", status: { name: options.status ?? "Done" } },
      "Created time": {
        type: "created_time",
        created_time: options.createdIso ?? "2026-04-15T03:00:00.000Z",
      },
      Assignee: {
        type: "people",
        people: (options.assignees ?? []).map((name) => ({ name })),
      },
      Follower: {
        type: "people",
        people: (options.followers ?? []).map((name) => ({ name })),
      },
    },
  };
}

describe("pagesAsReviewer", () => {
  const windowStart = new Date("2026-04-01T00:00:00Z");
  const windowEnd = new Date("2026-04-30T23:59:59Z");
  const nowInsideTargetMonth = new Date("2026-04-15T03:00:00.000Z");

  it("keeps pages where reviewer is Follower but not Assignee", () => {
    const pages = [
      pageWith({ id: "a", followers: ["LamDN"], assignees: ["DangDM"] }),
      pageWith({ id: "b", followers: ["DangDM"], assignees: ["LamDN"] }),
    ];
    const result = pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowInsideTargetMonth, new Set());
    expect(result.map((page) => page.id)).toEqual(["a"]);
  });

  it("excludes pages where reviewer is both Assignee and Follower", () => {
    const pages = [pageWith({ id: "a", assignees: ["LamDN"], followers: ["LamDN"] })];
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowInsideTargetMonth, new Set())).toEqual([]);
  });

  it("drops pages with non-syncable status", () => {
    const pages = [
      pageWith({ id: "a", followers: ["LamDN"], assignees: ["X"], status: "Cancelled" }),
    ];
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowInsideTargetMonth, new Set())).toEqual([]);
  });

  it("drops pages created before target month", () => {
    const pages = [
      pageWith({
        id: "a",
        followers: ["LamDN"],
        assignees: ["X"],
        createdIso: "2026-03-15T03:00:00.000Z",
      }),
    ];
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowInsideTargetMonth, new Set())).toEqual([]);
  });

  it("drops pages created after target month when sync is run on a non-today date", () => {
    const pages = [
      pageWith({
        id: "a",
        followers: ["LamDN"],
        assignees: ["X"],
        createdIso: "2026-05-02T03:00:00.000Z",
      }),
    ];
    const nowAfterMonth = new Date("2026-05-04T10:00:00.000Z");
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowAfterMonth, new Set())).toEqual([]);
  });

  it("keeps tasks created TODAY (Vietnam day) even when target month is past", () => {
    const pages = [
      pageWith({
        id: "a",
        followers: ["LamDN"],
        assignees: ["X"],
        createdIso: "2026-05-04T03:00:00.000Z",
      }),
    ];
    const nowToday = new Date("2026-05-04T10:00:00.000Z");
    const result = pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowToday, new Set());
    expect(result.map((page) => page.id)).toEqual(["a"]);
  });

  it("drops pages already counted in other sections", () => {
    const pages = [pageWith({ id: "a", followers: ["LamDN"], assignees: ["X"] })];
    const inOther = new Set(["a"]);
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, nowInsideTargetMonth, inOther)).toEqual([]);
  });
});

describe("relatedDevTabsForReviewer", () => {
  const memberByNotionName = new Map<string, MemberRoleInfo>([
    ["Lê Thạch Cương", { tabName: "CuongLT", role: "Developer" }],
    ["Tuấn Dương Nguyễn", { tabName: "DuongNT", role: "Developer" }],
    ["Dương Ngọc Lâm", { tabName: "LamDN", role: "PO" }],
    ["Nguyễn Ngọc Anh", { tabName: "AnhNN", role: "Tester" }],
  ]);

  it("returns Dev tabs for assignees of follower-pages", () => {
    const pages = [
      pageWith({ id: "a", followers: ["DangDM"], assignees: ["Lê Thạch Cương"] }),
    ];
    expect([...relatedDevTabsForReviewer(pages, memberByNotionName)]).toEqual(["CuongLT"]);
  });

  it("ignores assignees whose role is not Developer", () => {
    const pages = [
      pageWith({ id: "a", followers: ["DangDM"], assignees: ["Dương Ngọc Lâm", "Nguyễn Ngọc Anh"] }),
    ];
    expect([...relatedDevTabsForReviewer(pages, memberByNotionName)]).toEqual([]);
  });

  it("collects multiple Dev tabs from different pages and Co-Assignees", () => {
    const pages = [
      pageWith({ id: "a", followers: ["DangDM"], assignees: ["Lê Thạch Cương", "Nguyễn Ngọc Anh"] }),
      pageWith({ id: "b", followers: ["DangDM"], assignees: ["Tuấn Dương Nguyễn"] }),
    ];
    expect([...relatedDevTabsForReviewer(pages, memberByNotionName)].sort()).toEqual(
      ["CuongLT", "DuongNT"],
    );
  });

  it("ignores assignees not present in member map", () => {
    const pages = [pageWith({ id: "a", followers: ["DangDM"], assignees: ["Unknown Person"] })];
    expect([...relatedDevTabsForReviewer(pages, memberByNotionName)]).toEqual([]);
  });
});

describe("buildSubleadReviewFormulaFromDevTotals", () => {
  it("returns null for empty related-tabs set", () => {
    expect(buildSubleadReviewFormulaFromDevTotals([], new Map(), "G")).toBeNull();
  });

  it("emits ROUND(sum of section-header refs, 2) for each related Dev tab", () => {
    const headers = new Map<string, number>([
      ["CuongLT", 37],
      ["DuongNT", 42],
    ]);
    const formula = buildSubleadReviewFormulaFromDevTotals(["CuongLT", "DuongNT"], headers, "G");
    expect(formula).toBe("=ROUND(CuongLT!G37+DuongNT!G42, 2)");
  });

  it("dedups repeated tab names", () => {
    const headers = new Map<string, number>([["CuongLT", 37]]);
    const formula = buildSubleadReviewFormulaFromDevTotals(["CuongLT", "CuongLT"], headers, "G");
    expect(formula).toBe("=ROUND(CuongLT!G37, 2)");
  });

  it("skips tabs without a section header in the target month", () => {
    const headers = new Map<string, number>([["CuongLT", 37]]);
    const formula = buildSubleadReviewFormulaFromDevTotals(["CuongLT", "DuongNT"], headers, "G");
    expect(formula).toBe("=ROUND(CuongLT!G37, 2)");
  });

  it("returns null when none of the related tabs have a section header", () => {
    const formula = buildSubleadReviewFormulaFromDevTotals(["CuongLT"], new Map(), "G");
    expect(formula).toBeNull();
  });
});
