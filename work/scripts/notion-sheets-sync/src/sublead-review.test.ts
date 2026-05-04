import { describe, it, expect } from "vitest";
import {
  subleadReviewPoint,
  buildSubleadReviewNote,
  isSubleadReviewNote,
  originalTaskPoint,
  pagesAsSubleadFollower,
  buildSubleadReviewRow,
} from "./sublead-review.ts";
import type { NotionPage } from "./notion/client.ts";
import { COLUMN_INDEX } from "./constants.ts";

interface PageOptions {
  id: string;
  title?: string;
  status?: string;
  createdIso?: string;
  storyPoint?: number;
  sizeCard?: number;
  assignees?: string[];
  followers?: string[];
  tags?: string[];
}

function pageWith(options: PageOptions): NotionPage {
  return {
    id: options.id,
    properties: {
      product: {
        type: "title",
        title: [{ plain_text: options.title ?? `Task ${options.id}` }],
      },
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
      Tag: {
        type: "multi_select",
        multi_select: (options.tags ?? []).map((name) => ({ name })),
      },
    },
  };
}

describe("subleadReviewPoint", () => {
  it("returns 20% of the original point with no float drift", () => {
    expect(subleadReviewPoint(1)).toBe(0.2);
    expect(subleadReviewPoint(5)).toBe(1);
    expect(subleadReviewPoint(8)).toBe(1.6);
    expect(subleadReviewPoint(13)).toBe(2.6);
    expect(subleadReviewPoint(21)).toBe(4.2);
  });

  it("returns 0 for 0 or empty input", () => {
    expect(subleadReviewPoint(0)).toBe(0);
  });
});

describe("buildSubleadReviewNote / isSubleadReviewNote", () => {
  it("composes a note that round-trips through the detector", () => {
    const note = buildSubleadReviewNote(8);
    expect(note).toBe("Review (Sublead) • 20% × 8");
    expect(isSubleadReviewNote(note)).toBe(true);
  });

  it("does not flag arbitrary user notes", () => {
    expect(isSubleadReviewNote("")).toBe(false);
    expect(isSubleadReviewNote("Reviewed by lead")).toBe(false);
    expect(isSubleadReviewNote("note: looks good")).toBe(false);
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

describe("pagesAsSubleadFollower", () => {
  const windowStart = new Date("2026-04-01T00:00:00Z");
  const windowEnd = new Date("2026-04-30T23:59:59Z");

  it("keeps pages where sublead is a Follower but not an Assignee", () => {
    const pages = [
      pageWith({ id: "a", followers: ["LamDN"], assignees: ["DangDM"] }),
      pageWith({ id: "b", followers: ["DangDM"], assignees: ["LamDN"] }),
    ];
    const result = pagesAsSubleadFollower(pages, "LamDN", windowStart, windowEnd, new Set());
    expect(result.map((page) => page.id)).toEqual(["a"]);
  });

  it("excludes pages where sublead is both Assignee and Follower (no double counting)", () => {
    const pages = [pageWith({ id: "a", assignees: ["LamDN"], followers: ["LamDN"] })];
    expect(pagesAsSubleadFollower(pages, "LamDN", windowStart, windowEnd, new Set())).toEqual([]);
  });

  it("drops pages with non-syncable status", () => {
    const pages = [
      pageWith({ id: "a", followers: ["LamDN"], assignees: ["X"], status: "Cancelled" }),
    ];
    expect(pagesAsSubleadFollower(pages, "LamDN", windowStart, windowEnd, new Set())).toEqual([]);
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
    expect(pagesAsSubleadFollower(pages, "LamDN", windowStart, windowEnd, new Set())).toEqual([]);
  });

  it("drops pages already counted in another section", () => {
    const pages = [pageWith({ id: "a", followers: ["LamDN"], assignees: ["X"] })];
    const inOther = new Set(["a"]);
    expect(pagesAsSubleadFollower(pages, "LamDN", windowStart, windowEnd, inOther)).toEqual([]);
  });
});

describe("buildSubleadReviewRow", () => {
  it("emits row with discounted point and review note", () => {
    const page = pageWith({
      id: "abc12345-def0-1234-5678-9abcdef01234",
      title: "Some task",
      sizeCard: 8,
      assignees: ["DangDM"],
      followers: ["LamDN"],
      status: "Done",
      tags: ["PPU"],
    });
    const row = buildSubleadReviewRow(page, 8);
    expect(row[COLUMN_INDEX.title]).toBe("Some task");
    expect(row[COLUMN_INDEX.point]).toBe("1.6");
    expect(row[COLUMN_INDEX.assignees]).toBe("DangDM");
    expect(row[COLUMN_INDEX.followers]).toBe("LamDN");
    expect(row[COLUMN_INDEX.note]).toBe("Review (Sublead) • 20% × 8");
    expect(row[COLUMN_INDEX.link]).toContain("notion.so");
  });
});
