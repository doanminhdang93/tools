import { describe, expect, it } from "vitest";
import { htmlToBlocks } from "../src/html-to-blocks.ts";

const baseUrl = "https://avada-development.web.app";

describe("htmlToBlocks — simple blocks", () => {
  it("converts h1, h2, h3", () => {
    const blocks = htmlToBlocks("<h1>A</h1><h2>B</h2><h3>C</h3>", baseUrl);
    expect(blocks.map((b) => b.type)).toEqual(["heading_1", "heading_2", "heading_3"]);
  });

  it("treats h4+ as heading_3", () => {
    const blocks = htmlToBlocks("<h4>X</h4><h5>Y</h5>", baseUrl);
    expect(blocks.every((b) => b.type === "heading_3")).toBe(true);
  });

  it("converts paragraph", () => {
    const blocks = htmlToBlocks("<p>Hello world</p>", baseUrl);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    const para = blocks[0] as { type: "paragraph"; paragraph: { rich_text: Array<{ plain_text: string }> } };
    expect(para.paragraph.rich_text[0].plain_text).toBe("Hello world");
  });

  it("converts hr to divider", () => {
    const blocks = htmlToBlocks("<hr/>", baseUrl);
    expect(blocks[0].type).toBe("divider");
  });

  it("converts blockquote to quote", () => {
    const blocks = htmlToBlocks("<blockquote>Said it</blockquote>", baseUrl);
    expect(blocks[0].type).toBe("quote");
  });
});

describe("htmlToBlocks — inline annotations", () => {
  it("preserves bold, italic, code, and links", () => {
    const html =
      '<p><strong>bold</strong> <em>ital</em> <code>kode</code> <a href="/x">link</a> plain</p>';
    const blocks = htmlToBlocks(html, baseUrl);
    const para = blocks[0] as {
      paragraph: {
        rich_text: Array<{
          plain_text: string;
          annotations: { bold: boolean; italic: boolean; code: boolean };
          href: string | null;
        }>;
      };
    };
    const map = Object.fromEntries(para.paragraph.rich_text.map((r) => [r.plain_text.trim(), r]));
    expect(map["bold"].annotations.bold).toBe(true);
    expect(map["ital"].annotations.italic).toBe(true);
    expect(map["kode"].annotations.code).toBe(true);
    expect(map["link"].href).toBe("https://avada-development.web.app/x");
  });
});

describe("htmlToBlocks — 2000-char split", () => {
  it("splits a very long paragraph into multiple rich_text fragments", () => {
    const longText = "x".repeat(5000);
    const blocks = htmlToBlocks(`<p>${longText}</p>`, baseUrl);
    const para = blocks[0] as { paragraph: { rich_text: Array<{ plain_text: string }> } };
    expect(para.paragraph.rich_text.length).toBeGreaterThanOrEqual(3);
    expect(para.paragraph.rich_text.every((r) => r.plain_text.length <= 2000)).toBe(true);
  });
});
