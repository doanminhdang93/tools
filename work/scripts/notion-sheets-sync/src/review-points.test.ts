import { describe, it, expect } from "vitest";
import {
  discountedReviewPoint,
  originalTaskPoint,
  pagesAsReviewer,
  totalReviewPoints,
  buildReviewPointFormula,
  type PageRowLocation,
} from "./review-points.ts";
import type { NotionPage } from "./notion/client.ts";

interface PageOptions {
  id: string;
  status?: string;
  createdIso?: string;
  storyPoint?: number;
  sizeCard?: number;
  assignees?: string[];
  followers?: string[];
}

function pageWith(options: PageOptions): NotionPage {
  return {
    id: options.id,
    properties: {
      Status: {
        type: "status",
        status: { name: options.status ?? "Done" },
      },
      "Created time": {
        type: "created_time",
        created_time: options.createdIso ?? "2026-04-15T03:00:00.000Z",
      },
      "Size Card": {
        type: "select",
        select: options.sizeCard ? { name: String(options.sizeCard) } : null,
      },
      "Story Point": {
        type: "select",
        select: options.storyPoint ? { name: String(options.storyPoint) } : null,
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

describe("discountedReviewPoint", () => {
  it("returns 20% with no float drift across common point sizes", () => {
    expect(discountedReviewPoint(1)).toBe(0.2);
    expect(discountedReviewPoint(5)).toBe(1);
    expect(discountedReviewPoint(8)).toBe(1.6);
    expect(discountedReviewPoint(13)).toBe(2.6);
    expect(discountedReviewPoint(21)).toBe(4.2);
  });

  it("returns 0 for empty input", () => {
    expect(discountedReviewPoint(0)).toBe(0);
  });
});

describe("originalTaskPoint", () => {
  it("prefers Story Point when set", () => {
    expect(originalTaskPoint(pageWith({ id: "a", storyPoint: 8, sizeCard: 3 }))).toBe(8);
  });

  it("falls back to Size Card when Story Point is empty", () => {
    expect(originalTaskPoint(pageWith({ id: "a", sizeCard: 5 }))).toBe(5);
  });

  it("returns 0 when both are empty", () => {
    expect(originalTaskPoint(pageWith({ id: "a" }))).toBe(0);
  });
});

describe("pagesAsReviewer", () => {
  const windowStart = new Date("2026-04-01T00:00:00Z");
  const windowEnd = new Date("2026-04-30T23:59:59Z");

  it("keeps pages where reviewer is a Follower but not an Assignee", () => {
    const pages = [
      pageWith({ id: "a", followers: ["LamDN"], assignees: ["DangDM"] }),
      pageWith({ id: "b", followers: ["DangDM"], assignees: ["LamDN"] }),
    ];
    const result = pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, new Set());
    expect(result.map((page) => page.id)).toEqual(["a"]);
  });

  it("excludes pages where reviewer is both Assignee and Follower", () => {
    const pages = [pageWith({ id: "a", assignees: ["LamDN"], followers: ["LamDN"] })];
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, new Set())).toEqual([]);
  });

  it("drops pages with non-syncable status", () => {
    const pages = [
      pageWith({ id: "a", followers: ["LamDN"], assignees: ["X"], status: "Cancelled" }),
    ];
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, new Set())).toEqual([]);
  });

  it("drops pages whose created_time is outside the window", () => {
    const pages = [
      pageWith({
        id: "a",
        followers: ["LamDN"],
        assignees: ["X"],
        createdIso: "2026-03-15T03:00:00.000Z",
      }),
    ];
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, new Set())).toEqual([]);
  });

  it("drops pages already counted in another section", () => {
    const pages = [pageWith({ id: "a", followers: ["LamDN"], assignees: ["X"] })];
    const inOther = new Set(["a"]);
    expect(pagesAsReviewer(pages, "LamDN", windowStart, windowEnd, inOther)).toEqual([]);
  });
});

describe("buildReviewPointFormula", () => {
  function pageWithId(id: string, sizeCard: number): NotionPage {
    return pageWith({ id, sizeCard });
  }

  it("returns null for empty page list", () => {
    expect(buildReviewPointFormula([], new Map(), "F")).toBeNull();
  });

  it("emits cell refs for each mapped page", () => {
    const map = new Map<string, PageRowLocation>([
      ["abc12345def012345678901234567890", { tabName: "DangDM", row: 8 }],
      ["fed98765abc012345678901234567890", { tabName: "ChienNH", row: 12 }],
    ]);
    const pages = [
      pageWithId("abc12345-def0-1234-5678-901234567890", 8),
      pageWithId("fed98765-abc0-1234-5678-901234567890", 5),
    ];
    expect(buildReviewPointFormula(pages, map, "F")).toBe(
      "=ROUND(0.2*(DangDM!F8+ChienNH!F12), 2)",
    );
  });

  it("falls back to static sum for unmapped pages", () => {
    const pages = [pageWithId("abc12345-def0-1234-5678-901234567890", 5)];
    expect(buildReviewPointFormula(pages, new Map(), "F")).toBe("=ROUND(0.2*(5), 2)");
  });

  it("mixes refs and static fallback", () => {
    const map = new Map<string, PageRowLocation>([
      ["abc12345def012345678901234567890", { tabName: "DangDM", row: 8 }],
    ]);
    const pages = [
      pageWithId("abc12345-def0-1234-5678-901234567890", 8),
      pageWithId("fed98765-abc0-1234-5678-901234567890", 5),
    ];
    expect(buildReviewPointFormula(pages, map, "F")).toBe("=ROUND(0.2*(DangDM!F8+5), 2)");
  });
});

describe("totalReviewPoints", () => {
  it("sums 20%-discounted points without float drift", () => {
    const pages = [
      pageWith({ id: "a", sizeCard: 13 }),
      pageWith({ id: "b", sizeCard: 8 }),
      pageWith({ id: "c", sizeCard: 5 }),
    ];
    expect(totalReviewPoints(pages)).toBe(5.2);
  });

  it("returns 0 for empty list", () => {
    expect(totalReviewPoints([])).toBe(0);
  });

  it("treats pages with no point as 0 in the sum", () => {
    const pages = [pageWith({ id: "a", sizeCard: 5 }), pageWith({ id: "b" })];
    expect(totalReviewPoints(pages)).toBe(1);
  });
});
