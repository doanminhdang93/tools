import { describe, it, expect } from "vitest";
import {
  collectAssigneeNames,
  filterByAssignee,
  type NotionPage,
} from "./client.ts";

function pageWith(options: {
  id: string;
  assignees?: string[];
  followers?: string[];
}): NotionPage {
  return {
    id: options.id,
    properties: {
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

describe("filterByAssignee", () => {
  it("keeps pages where the person is an Assignee", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Alice"] }),
      pageWith({ id: "b", assignees: ["Bob"] }),
    ];
    expect(filterByAssignee(pages, "Alice").map((p) => p.id)).toEqual(["a"]);
  });

  it("drops pages where the person is only a Follower (not Assignee)", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Bob"], followers: ["Alice"] }),
      pageWith({ id: "b", assignees: ["Alice"], followers: ["Bob"] }),
    ];
    expect(filterByAssignee(pages, "Alice").map((p) => p.id)).toEqual(["b"]);
  });

  it("returns empty when the person appears on no page", () => {
    const pages = [pageWith({ id: "a", assignees: ["Bob"] })];
    expect(filterByAssignee(pages, "Alice")).toEqual([]);
  });
});

describe("collectAssigneeNames", () => {
  it("collects unique Assignee names across pages", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Alice", "Bob"] }),
      pageWith({ id: "b", assignees: ["Alice"] }),
      pageWith({ id: "c", assignees: ["Carol"] }),
    ];
    expect([...collectAssigneeNames(pages)].sort()).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("ignores Follower-only names", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Alice"], followers: ["Dawn"] }),
    ];
    expect([...collectAssigneeNames(pages)]).toEqual(["Alice"]);
  });

  it("ignores pages where Assignee is missing or empty", () => {
    const pages: NotionPage[] = [
      { id: "a", properties: {} },
      { id: "b", properties: { Assignee: { type: "people", people: [] } } },
    ];
    expect(collectAssigneeNames(pages).size).toBe(0);
  });
});
