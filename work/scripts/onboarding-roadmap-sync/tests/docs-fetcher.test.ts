import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractMainContent, parseSidebar } from "../src/docs-fetcher.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixture(name: string): Promise<string> {
  const path = resolve(__dirname, "fixtures", name);
  return await readFile(path, "utf-8");
}

const WEEK_SECTIONS: Record<number, string> = {
  1: "Week 1 Warm-up",
  2: "Week 2 ReactJS",
  3: "Week 3 Firebase and Shopify",
  4: "Week 4 Final exam",
};

describe("parseSidebar", () => {
  it("returns Week 1-4 items only", async () => {
    const html = await loadFixture("sidebar.html");
    const items = parseSidebar(html, WEEK_SECTIONS, "https://avada-development.web.app");
    const weeks = new Set(items.map((i) => i.week));
    expect(weeks).toEqual(new Set([1, 2, 3, 4]));
  });

  it("returns absolute URLs", async () => {
    const html = await loadFixture("sidebar.html");
    const items = parseSidebar(html, WEEK_SECTIONS, "https://avada-development.web.app");
    expect(items.every((i) => i.url.startsWith("https://avada-development.web.app/"))).toBe(true);
  });

  it("includes the Week 1 'Getting started' entry", async () => {
    const html = await loadFixture("sidebar.html");
    const items = parseSidebar(html, WEEK_SECTIONS, "https://avada-development.web.app");
    const found = items.find((i) => i.title === "Getting started" && i.week === 1);
    expect(found).toBeDefined();
  });
});

describe("extractMainContent", () => {
  it("returns content text from sl-markdown-content", async () => {
    const html = await loadFixture("page-content.html");
    const text = extractMainContent(html);
    expect(text.length).toBeGreaterThan(200);
    expect(text.toLowerCase()).toContain("coding standard");
  });

  it("returns empty string when sl-markdown-content missing", () => {
    const text = extractMainContent("<html><body><p>no marker</p></body></html>");
    expect(text).toBe("");
  });
});
