import { describe, it, expect } from "vitest";
import {
  collectInvolvedPeopleNames,
  filterByInvolvedPerson,
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

describe("filterByInvolvedPerson", () => {
  it("keeps pages where the person is an Assignee", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Alice"] }),
      pageWith({ id: "b", assignees: ["Bob"] }),
    ];
    expect(filterByInvolvedPerson(pages, "Alice").map((p) => p.id)).toEqual(["a"]);
  });

  it("keeps pages where the person is a Follower only", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Bob"], followers: ["Alice"] }),
      pageWith({ id: "b", assignees: ["Bob"] }),
    ];
    expect(filterByInvolvedPerson(pages, "Alice").map((p) => p.id)).toEqual(["a"]);
  });

  it("deduplicates when the person is both Assignee and Follower on the same page", () => {
    const pages = [pageWith({ id: "a", assignees: ["Alice"], followers: ["Alice"] })];
    expect(filterByInvolvedPerson(pages, "Alice").map((p) => p.id)).toEqual(["a"]);
  });

  it("returns empty when the person appears on no page", () => {
    const pages = [pageWith({ id: "a", assignees: ["Bob"] })];
    expect(filterByInvolvedPerson(pages, "Alice")).toEqual([]);
  });
});

describe("collectInvolvedPeopleNames", () => {
  it("unions unique names across Assignee and Follower fields", () => {
    const pages = [
      pageWith({ id: "a", assignees: ["Alice", "Bob"] }),
      pageWith({ id: "b", followers: ["Carol"] }),
      pageWith({ id: "c", assignees: ["Alice"], followers: ["Bob", "Dawn"] }),
    ];
    expect([...collectInvolvedPeopleNames(pages)].sort()).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dawn",
    ]);
  });

  it("ignores pages where people fields are missing or malformed", () => {
    const pages: NotionPage[] = [
      { id: "a", properties: {} },
      { id: "b", properties: { Assignee: { type: "people", people: [] } } },
    ];
    expect(collectInvolvedPeopleNames(pages).size).toBe(0);
  });
});
