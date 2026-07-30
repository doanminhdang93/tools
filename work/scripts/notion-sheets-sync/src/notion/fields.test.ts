import { describe, expect, it } from "vitest";
import { assigneeNamesOf, doneDateOf, titleOf } from "./fields.ts";
import type { NotionPage } from "./client.ts";

function pageWithProperties(properties: Record<string, unknown>): NotionPage {
  return { id: "page-1", properties } as unknown as NotionPage;
}

function pageWithTitleProperty(propertyName: string, text: string): NotionPage {
  return {
    id: "page-1",
    properties: {
      Status: { type: "status", status: { name: "Done" } },
      [propertyName]: {
        type: "title",
        title: [{ plain_text: text }],
      },
    },
  } as unknown as NotionPage;
}

describe("titleOf", () => {
  it("reads the title regardless of the title property's name", () => {
    expect(titleOf(pageWithTitleProperty("product", "Old name"))).toBe("Old name");
    // Notion renamed the title property to an empty string — must still resolve.
    expect(titleOf(pageWithTitleProperty("", "Renamed prop"))).toBe("Renamed prop");
  });

  it("returns empty string when no title-typed property exists", () => {
    const page = {
      id: "page-2",
      properties: { Status: { type: "status", status: { name: "Done" } } },
    } as unknown as NotionPage;
    expect(titleOf(page)).toBe("");
  });
});

describe("assigneeNamesOf", () => {
  it("reads the renamed 'Person' property", () => {
    const page = pageWithProperties({
      Person: { type: "people", people: [{ name: "Alice" }, { name: "Bob" }] },
    });
    expect(assigneeNamesOf(page)).toEqual(["Alice", "Bob"]);
  });

  it("falls back to the legacy 'Assignee' property", () => {
    const page = pageWithProperties({
      Person: { type: "people", people: [] },
      Assignee: { type: "people", people: [{ name: "Alice" }] },
    });
    expect(assigneeNamesOf(page)).toEqual(["Alice"]);
  });

  it("returns empty when neither property holds people", () => {
    expect(assigneeNamesOf(pageWithProperties({}))).toEqual([]);
    expect(
      assigneeNamesOf(pageWithProperties({ Person: { type: "people", people: [] } })),
    ).toEqual([]);
  });
});

describe("doneDateOf", () => {
  it("reads the date start value", () => {
    const page = pageWithProperties({
      "Done date": { type: "date", date: { start: "2026-07-30T09:54:00.000+07:00" } },
    });
    expect(doneDateOf(page)).toBe("2026-07-30T09:54:00.000+07:00");
  });

  it("returns empty string when the field is unset or missing", () => {
    expect(doneDateOf(pageWithProperties({ "Done date": { type: "date", date: null } }))).toBe("");
    expect(doneDateOf(pageWithProperties({}))).toBe("");
  });
});
