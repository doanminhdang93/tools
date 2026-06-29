import { describe, expect, it } from "vitest";
import { titleOf } from "./fields.ts";
import type { NotionPage } from "./client.ts";

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
