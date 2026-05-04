import { describe, it, expect } from "vitest";
import {
  pagesAsReviewer,
  buildCrossTabReviewFormula,
  type PageRowLocation,
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

describe("buildCrossTabReviewFormula", () => {
  it("returns null for empty pages", () => {
    expect(buildCrossTabReviewFormula([], new Map(), "G")).toBeNull();
  });

  it("emits ROUND(sum of review-cell refs, 2) without re-multiplying by 0.2", () => {
    const map = new Map<string, PageRowLocation>([
      ["abc12345def012345678901234567890", { tabName: "DangDM", row: 8 }],
      ["fed98765abc012345678901234567890", { tabName: "ChienNH", row: 12 }],
    ]);
    const pages = [
      pageWith({ id: "abc12345-def0-1234-5678-901234567890" }),
      pageWith({ id: "fed98765-abc0-1234-5678-901234567890" }),
    ];
    expect(buildCrossTabReviewFormula(pages, map, "G")).toBe(
      "=ROUND(DangDM!G8+ChienNH!G12, 2)",
    );
  });

  it("returns null when no pages are mapped", () => {
    const pages = [pageWith({ id: "abc12345-def0-1234-5678-901234567890" })];
    expect(buildCrossTabReviewFormula(pages, new Map(), "G")).toBeNull();
  });

  it("skips unmapped pages", () => {
    const map = new Map<string, PageRowLocation>([
      ["abc12345def012345678901234567890", { tabName: "DangDM", row: 8 }],
    ]);
    const pages = [
      pageWith({ id: "abc12345-def0-1234-5678-901234567890" }),
      pageWith({ id: "fed98765-abc0-1234-5678-901234567890" }),
    ];
    expect(buildCrossTabReviewFormula(pages, map, "G")).toBe("=ROUND(DangDM!G8, 2)");
  });
});
