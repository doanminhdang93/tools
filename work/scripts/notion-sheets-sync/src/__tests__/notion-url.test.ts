import { describe, it, expect } from "vitest";
import { buildNotionUrl, extractPageIdFromUrl, normalizeNotionPageId } from "../notion-url.ts";

describe("buildNotionUrl", () => {
  it("strips dashes and lowercases the id", () => {
    const pageId = "1EAB0DA4-49F1-801F-8371-D832511943CD";
    expect(buildNotionUrl(pageId)).toBe("https://www.notion.so/1eab0da449f1801f8371d832511943cd");
  });

  it("leaves a canonical id unchanged in path", () => {
    expect(buildNotionUrl("1eab0da449f1801f8371d832511943cd")).toBe(
      "https://www.notion.so/1eab0da449f1801f8371d832511943cd",
    );
  });
});

describe("extractPageIdFromUrl", () => {
  it("extracts the 32-char hex id before the query string", () => {
    const url =
      "https://www.notion.so/avadagroup/Bug-1eab0da449f1801f8371d832511943cd?pvs=4";
    expect(extractPageIdFromUrl(url)).toBe("1eab0da449f1801f8371d832511943cd");
  });

  it("extracts the id at the end of the URL", () => {
    const url = "https://www.notion.so/1eab0da449f1801f8371d832511943cd";
    expect(extractPageIdFromUrl(url)).toBe("1eab0da449f1801f8371d832511943cd");
  });

  it("returns null for a URL without a page id", () => {
    expect(extractPageIdFromUrl("https://www.notion.so/some-workspace")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractPageIdFromUrl("")).toBeNull();
  });
});

describe("normalizeNotionPageId", () => {
  it("lowercases and removes dashes", () => {
    expect(normalizeNotionPageId("1EAB0DA4-49F1-801F-8371-D832511943CD")).toBe(
      "1eab0da449f1801f8371d832511943cd",
    );
  });
});
