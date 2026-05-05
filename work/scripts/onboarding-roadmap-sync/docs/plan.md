# onboarding-roadmap-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI tool that mirrors the X Team's Starlight docs-site onboarding roadmap (Week 1–4) into a Notion master template, supports per-task add/update, and customises duplicated copies for new developers.

**Architecture:** Three CLI entry points (`sync`, `add-task`, `new-dev`) on top of a shared library: `docs-fetcher` (HTTP + cheerio HTML parsing), `html-to-blocks` (HTML → Notion blocks), `notion-client` (Notion SDK helpers), and small utilities (`matching`, `chunking`, `logger`). Match key for idempotency is a `Source URL` property added to the DB; content drift is detected via a `Source Hash` (SHA-256 prefix of normalised text).

**Tech Stack:** Node.js 20+, TypeScript 5, `@notionhq/client`, `cheerio`, `@inquirer/prompts`, `commander`, `dotenv`, `vitest` (no Notion mocks — fixture-based unit tests + manual `--dry-run` smoke tests).

**Spec:** [./design.md](./design.md)

**Run all commands from:** `work/scripts/onboarding-roadmap-sync/`

---

## Task 1: Project scaffold

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/package.json`
- Create: `work/scripts/onboarding-roadmap-sync/tsconfig.json`
- Create: `work/scripts/onboarding-roadmap-sync/vitest.config.ts`
- Create: `work/scripts/onboarding-roadmap-sync/.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "onboarding-roadmap-sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "tsx src/sync.ts",
    "add-task": "tsx src/add-task.ts",
    "new-dev": "tsx src/new-dev.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@notionhq/client": "^2.2.15",
    "@inquirer/prompts": "^7.2.1",
    "cheerio": "^1.0.0",
    "commander": "^12.1.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` (matches `notion-sheets-sync`)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*", "*.config.ts", "*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```text
node_modules/
*.log
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: installs without errors, produces `package-lock.json` and `node_modules/`.

- [ ] **Step 6: Verify typecheck passes on empty project**

Run: `npm run typecheck`
Expected: PASS (no source files to check yet, exits 0).

- [ ] **Step 7: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/package.json \
        work/scripts/onboarding-roadmap-sync/tsconfig.json \
        work/scripts/onboarding-roadmap-sync/vitest.config.ts \
        work/scripts/onboarding-roadmap-sync/.gitignore \
        work/scripts/onboarding-roadmap-sync/package-lock.json
git commit -m "feat(onboarding-roadmap-sync): scaffold package, tsconfig, vitest"
```

---

## Task 2: `config.ts`

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/config.ts`

- [ ] **Step 1: Create the config file**

```ts
export const DOCS_BASE_URL = "https://avada-development.web.app";

export const SIDEBAR_SEED_URL =
  "https://avada-development.web.app/training-docs/week-1-warm-up/i01-nodejs_basic/";

export const NOTION_PAGE_ID = "2f4b0da4-49f1-80b0-9425-fee0f44f6834";
export const NOTION_DB_ID = "2f4b0da4-49f1-81e7-868f-cc54f37e33ab";

export const WEEK_SECTIONS: Record<number, string> = {
  1: "Week 1 Warm-up",
  2: "Week 2 ReactJS",
  3: "Week 3 Firebase and Shopify",
  4: "Week 4 Final exam",
};

export const DEFAULT_STATUS_FOR_NEW_TASK = "Not started";
export const RATE_LIMIT_MS = 350;

export const SOURCE_URL_PROP = "Source URL";
export const SOURCE_HASH_PROP = "Source Hash";
export const STATUS_PROP = "Status";
export const TAG_PROP = "tag";
export const NAME_PROP = "Name";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/config.ts
git commit -m "feat(onboarding-roadmap-sync): add config constants"
```

---

## Task 3: `src/logger.ts`

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/src/logger.ts`

- [ ] **Step 1: Create logger**

```ts
type Counters = { created: number; updated: number; skipped: number; orphans: number };

export function makeCounters(): Counters {
  return { created: 0, updated: 0, skipped: 0, orphans: 0 };
}

export const log = {
  info: (msg: string) => console.log(msg),
  ok: (msg: string) => console.log(`✓ ${msg}`),
  warn: (msg: string) => console.warn(`⚠ ${msg}`),
  error: (msg: string) => console.error(`✗ ${msg}`),
  summary: (c: Counters) =>
    console.log(
      `\nCreated ${c.created}, Updated ${c.updated}, Skipped ${c.skipped}, Orphans ${c.orphans}`,
    ),
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/logger.ts
git commit -m "feat(onboarding-roadmap-sync): add logger and counters"
```

---

## Task 4: `src/chunking.ts` (TDD)

**Files:**
- Test: `work/scripts/onboarding-roadmap-sync/tests/chunking.test.ts`
- Create: `work/scripts/onboarding-roadmap-sync/src/chunking.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { chunkArray, sleep } from "../src/chunking.ts";

describe("chunkArray", () => {
  it("splits an array into chunks of the requested size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when size exceeds length", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunkArray<number>([], 3)).toEqual([]);
  });
});

describe("sleep", () => {
  it("resolves after at least the given milliseconds", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chunking`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chunking`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/chunking.ts \
        work/scripts/onboarding-roadmap-sync/tests/chunking.test.ts
git commit -m "feat(onboarding-roadmap-sync): chunkArray, sleep, withRetry utilities"
```

---

## Task 5: `src/matching.ts` (TDD)

**Files:**
- Test: `work/scripts/onboarding-roadmap-sync/tests/matching.test.ts`
- Create: `work/scripts/onboarding-roadmap-sync/src/matching.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { hashContent, normaliseText } from "../src/matching.ts";

describe("normaliseText", () => {
  it("collapses whitespace and trims", () => {
    expect(normaliseText("  a   b\n\nc  ")).toBe("a b c");
  });
});

describe("hashContent", () => {
  it("returns 16 lowercase hex chars", () => {
    const h = hashContent("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across whitespace differences", () => {
    expect(hashContent("hello world")).toBe(hashContent("  hello   world  "));
  });

  it("differs when content differs", () => {
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- matching`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { createHash } from "node:crypto";

export function normaliseText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function hashContent(input: string): string {
  const normalised = normaliseText(input);
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- matching`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/matching.ts \
        work/scripts/onboarding-roadmap-sync/tests/matching.test.ts
git commit -m "feat(onboarding-roadmap-sync): hashContent and normaliseText"
```

---

## Task 6: `html-to-blocks` — rich text + simple blocks (TDD)

Covers paragraph, heading_1/2/3, divider, blockquote, inline annotations (bold/italic/code/link), and 2000-char rich_text splitting.

**Files:**
- Test: `work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts`
- Create: `work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts`

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- html-to-blocks`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (initial pass — simple blocks + inline + char-split)**

```ts
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode, Element } from "domhandler";

const MAX_RICH_TEXT_LEN = 2000;

type Annotations = {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: "default";
};

type RichText = {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
};

export type Block = Record<string, unknown> & { type: string };

const defaultAnnotations: Annotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default",
};

function makeRichText(content: string, anno: Annotations, href: string | null): RichText {
  return {
    type: "text",
    text: { content, link: href ? { url: href } : null },
    annotations: { ...anno },
    plain_text: content,
    href,
  };
}

function splitLongText(content: string, anno: Annotations, href: string | null): RichText[] {
  if (content.length <= MAX_RICH_TEXT_LEN) return [makeRichText(content, anno, href)];
  const out: RichText[] = [];
  for (let i = 0; i < content.length; i += MAX_RICH_TEXT_LEN) {
    out.push(makeRichText(content.slice(i, i + MAX_RICH_TEXT_LEN), anno, href));
  }
  return out;
}

function resolveUrl(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function inlineToRichText(
  $: cheerio.CheerioAPI,
  node: AnyNode,
  anno: Annotations,
  href: string | null,
  baseUrl: string,
): RichText[] {
  if (node.type === "text") {
    const content = (node as { data: string }).data ?? "";
    if (!content) return [];
    return splitLongText(content, anno, href);
  }
  if (node.type !== "tag") return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  let next = { ...anno };
  let nextHref = href;
  if (tag === "strong" || tag === "b") next.bold = true;
  if (tag === "em" || tag === "i") next.italic = true;
  if (tag === "code") next.code = true;
  if (tag === "del" || tag === "s") next.strikethrough = true;
  if (tag === "u") next.underline = true;
  if (tag === "a") nextHref = resolveUrl(el.attribs.href, baseUrl) ?? href;
  if (tag === "br") return [makeRichText("\n", anno, href)];
  const children = $(el).contents().toArray();
  return children.flatMap((child) => inlineToRichText($, child, next, nextHref, baseUrl));
}

function richTextOf($: cheerio.CheerioAPI, el: Cheerio<Element>, baseUrl: string): RichText[] {
  return el
    .contents()
    .toArray()
    .flatMap((child) => inlineToRichText($, child, defaultAnnotations, null, baseUrl));
}

function paragraphBlock(rich: RichText[]): Block {
  return { type: "paragraph", paragraph: { rich_text: rich, color: "default" } };
}

function headingBlock(level: 1 | 2 | 3, rich: RichText[]): Block {
  const key = `heading_${level}` as const;
  return { type: key, [key]: { rich_text: rich, color: "default", is_toggleable: false } };
}

function quoteBlock(rich: RichText[]): Block {
  return { type: "quote", quote: { rich_text: rich, color: "default" } };
}

function dividerBlock(): Block {
  return { type: "divider", divider: {} };
}

export function htmlToBlocks(html: string, baseUrl: string): Block[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const root = $("#root");
  const blocks: Block[] = [];
  root.children().each((_, el) => {
    blocks.push(...convertElement($, $(el) as Cheerio<Element>, baseUrl));
  });
  return blocks;
}

function convertElement(
  $: cheerio.CheerioAPI,
  el: Cheerio<Element>,
  baseUrl: string,
): Block[] {
  const tag = (el.get(0) as Element).tagName.toLowerCase();
  if (tag === "h1") return [headingBlock(1, richTextOf($, el, baseUrl))];
  if (tag === "h2") return [headingBlock(2, richTextOf($, el, baseUrl))];
  if (tag === "h3") return [headingBlock(3, richTextOf($, el, baseUrl))];
  if (tag === "h4" || tag === "h5" || tag === "h6") {
    return [headingBlock(3, richTextOf($, el, baseUrl))];
  }
  if (tag === "p") return [paragraphBlock(richTextOf($, el, baseUrl))];
  if (tag === "hr") return [dividerBlock()];
  if (tag === "blockquote") return [quoteBlock(richTextOf($, el, baseUrl))];
  // unhandled tags fall through (later tasks add list, code, table, image, aside)
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- html-to-blocks`
Expected: PASS (all simple/inline/char-split tests).

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts \
        work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts
git commit -m "feat(onboarding-roadmap-sync): html-to-blocks for headings, paragraph, hr, quote, inline, char-split"
```

---

## Task 7: `html-to-blocks` — lists + code blocks (TDD)

**Files:**
- Modify: `work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts`
- Modify: `work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts`

- [ ] **Step 1: Append failing tests to `tests/html-to-blocks.test.ts`**

```ts
describe("htmlToBlocks — lists", () => {
  it("converts a flat bulleted list", () => {
    const blocks = htmlToBlocks("<ul><li>A</li><li>B</li></ul>", "https://x");
    expect(blocks.map((b) => b.type)).toEqual([
      "bulleted_list_item",
      "bulleted_list_item",
    ]);
  });

  it("converts a numbered list", () => {
    const blocks = htmlToBlocks("<ol><li>A</li></ol>", "https://x");
    expect(blocks[0].type).toBe("numbered_list_item");
  });

  it("nests sub-lists as block children", () => {
    const blocks = htmlToBlocks("<ul><li>Outer<ul><li>Inner</li></ul></li></ul>", "https://x");
    const outer = blocks[0] as { bulleted_list_item: { children?: Array<{ type: string }> } };
    expect(outer.bulleted_list_item.children?.[0].type).toBe("bulleted_list_item");
  });
});

describe("htmlToBlocks — code blocks", () => {
  it("converts <pre><code class='language-js'>", () => {
    const blocks = htmlToBlocks(
      '<pre><code class="language-js">const a = 1;</code></pre>',
      "https://x",
    );
    expect(blocks[0].type).toBe("code");
    const code = blocks[0] as { code: { language: string; rich_text: Array<{ plain_text: string }> } };
    expect(code.code.language).toBe("javascript");
    expect(code.code.rich_text[0].plain_text).toBe("const a = 1;");
  });

  it("falls back to plain text when language missing", () => {
    const blocks = htmlToBlocks("<pre><code>raw</code></pre>", "https://x");
    const code = blocks[0] as { code: { language: string } };
    expect(code.code.language).toBe("plain text");
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npm test -- html-to-blocks`
Expected: FAIL (list and code tests fail because converter returns `[]` for those tags).

- [ ] **Step 3: Extend `src/html-to-blocks.ts`**

Add these helpers above `convertElement`:

```ts
const NOTION_CODE_LANGS = new Set([
  "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++",
  "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow",
  "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell",
  "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less",
  "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab",
  "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text",
  "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust",
  "sass", "scala", "scheme", "scss", "shell", "sql", "swift", "typescript",
  "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml",
]);

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "shell",
  yml: "yaml",
};

function detectLanguage(className: string | undefined): string {
  if (!className) return "plain text";
  const match = /language-([a-zA-Z0-9+#-]+)/.exec(className);
  if (!match) return "plain text";
  const raw = match[1].toLowerCase();
  const alias = LANGUAGE_ALIASES[raw] ?? raw;
  return NOTION_CODE_LANGS.has(alias) ? alias : "plain text";
}

function listItemBlock(
  type: "bulleted_list_item" | "numbered_list_item",
  rich: RichText[],
  children: Block[],
): Block {
  return {
    type,
    [type]: {
      rich_text: rich,
      color: "default",
      ...(children.length > 0 ? { children } : {}),
    },
  };
}

function convertList(
  $: cheerio.CheerioAPI,
  el: Cheerio<Element>,
  baseUrl: string,
  ordered: boolean,
): Block[] {
  const blocks: Block[] = [];
  el.children("li").each((_, li) => {
    const $li = $(li);
    const $clone = $li.clone();
    $clone.children("ul,ol").remove();
    const rich = richTextOf($, $clone as Cheerio<Element>, baseUrl);
    const children: Block[] = [];
    $li.children("ul,ol").each((_, child) => {
      const childOrdered = (child as Element).tagName.toLowerCase() === "ol";
      children.push(...convertList($, $(child) as Cheerio<Element>, baseUrl, childOrdered));
    });
    blocks.push(
      listItemBlock(ordered ? "numbered_list_item" : "bulleted_list_item", rich, children),
    );
  });
  return blocks;
}

function convertCode($: cheerio.CheerioAPI, el: Cheerio<Element>): Block {
  const codeEl = el.find("code").first();
  const className = codeEl.attr("class");
  const language = detectLanguage(className);
  const text = codeEl.text();
  return {
    type: "code",
    code: {
      rich_text: [
        {
          type: "text",
          text: { content: text, link: null },
          annotations: { ...defaultAnnotations },
          plain_text: text,
          href: null,
        },
      ],
      language,
    },
  };
}
```

Then add cases to `convertElement` (before the trailing `return []`):

```ts
  if (tag === "ul") return convertList($, el, baseUrl, false);
  if (tag === "ol") return convertList($, el, baseUrl, true);
  if (tag === "pre") return [convertCode($, el)];
```

- [ ] **Step 4: Run test to verify they pass**

Run: `npm test -- html-to-blocks`
Expected: PASS (all tests, including new list and code tests).

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts \
        work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts
git commit -m "feat(onboarding-roadmap-sync): html-to-blocks support for lists and code"
```

---

## Task 8: `html-to-blocks` — tables + images + asides (TDD)

**Files:**
- Modify: `work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts`
- Modify: `work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("htmlToBlocks — tables", () => {
  it("converts a 2x2 table with header", () => {
    const html = "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const blocks = htmlToBlocks(html, "https://x");
    expect(blocks[0].type).toBe("table");
    const table = blocks[0] as {
      table: {
        table_width: number;
        has_column_header: boolean;
        children: Array<{ type: string; table_row: { cells: Array<Array<{ plain_text: string }>> } }>;
      };
    };
    expect(table.table.table_width).toBe(2);
    expect(table.table.has_column_header).toBe(true);
    expect(table.table.children).toHaveLength(2);
    expect(table.table.children[0].table_row.cells[0][0].plain_text).toBe("A");
  });
});

describe("htmlToBlocks — images", () => {
  it("converts img to image block with absolute URL", () => {
    const blocks = htmlToBlocks('<img src="/foo.png" alt="x"/>', "https://x.com");
    expect(blocks[0].type).toBe("image");
    const img = blocks[0] as { image: { type: "external"; external: { url: string } } };
    expect(img.image.external.url).toBe("https://x.com/foo.png");
  });
});

describe("htmlToBlocks — asides (callouts)", () => {
  it("converts starlight aside to callout with mapped icon", () => {
    const blocks = htmlToBlocks(
      '<aside class="starlight-aside starlight-aside--tip"><p>tip</p></aside>',
      "https://x",
    );
    expect(blocks[0].type).toBe("callout");
    const callout = blocks[0] as { callout: { icon: { emoji: string } } };
    expect(callout.callout.icon.emoji).toBe("✅");
  });

  it("falls back to default icon for unknown aside variants", () => {
    const blocks = htmlToBlocks(
      '<aside class="starlight-aside"><p>x</p></aside>',
      "https://x",
    );
    const callout = blocks[0] as { callout: { icon: { emoji: string } } };
    expect(callout.callout.icon.emoji).toBe("💡");
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npm test -- html-to-blocks`
Expected: FAIL.

- [ ] **Step 3: Extend `src/html-to-blocks.ts`**

Add helpers above `convertElement`:

```ts
const ASIDE_ICONS: Record<string, string> = {
  note: "💡",
  tip: "✅",
  caution: "⚠️",
  danger: "🛑",
};

function detectAsideKind(className: string | undefined): string | null {
  if (!className) return null;
  const m = /starlight-aside--([a-z]+)/.exec(className);
  return m ? m[1] : null;
}

function convertTable($: cheerio.CheerioAPI, el: Cheerio<Element>, baseUrl: string): Block {
  const rows: Cheerio<Element>[] = [];
  el.find("tr").each((_, tr) => rows.push($(tr) as Cheerio<Element>));
  let tableWidth = 0;
  const tableRows = rows.map(($tr) => {
    const cells: RichText[][] = [];
    $tr.children("th,td").each((_, cell) => {
      cells.push(richTextOf($, $(cell) as Cheerio<Element>, baseUrl));
    });
    if (cells.length > tableWidth) tableWidth = cells.length;
    return cells;
  });
  for (const row of tableRows) {
    while (row.length < tableWidth) row.push([]);
  }
  const hasColumnHeader = el.find("thead th").length > 0;
  return {
    type: "table",
    table: {
      table_width: tableWidth,
      has_column_header: hasColumnHeader,
      has_row_header: false,
      children: tableRows.map((cells) => ({
        type: "table_row" as const,
        table_row: { cells },
      })),
    },
  };
}

function convertImage(el: Cheerio<Element>, baseUrl: string): Block | null {
  const src = el.attr("src");
  const url = resolveUrl(src, baseUrl);
  if (!url) return null;
  return { type: "image", image: { type: "external", external: { url } } };
}

function convertAside(
  $: cheerio.CheerioAPI,
  el: Cheerio<Element>,
  baseUrl: string,
): Block {
  const kind = detectAsideKind(el.attr("class"));
  const emoji = (kind && ASIDE_ICONS[kind]) ?? "💡";
  const rich = richTextOf($, el, baseUrl);
  return {
    type: "callout",
    callout: {
      rich_text: rich,
      icon: { type: "emoji", emoji },
      color: "default",
    },
  };
}
```

Add cases to `convertElement` (before the trailing `return []`):

```ts
  if (tag === "table") return [convertTable($, el, baseUrl)];
  if (tag === "img") {
    const img = convertImage(el, baseUrl);
    return img ? [img] : [];
  }
  if (tag === "aside") return [convertAside($, el, baseUrl)];
```

- [ ] **Step 4: Run test to verify they pass**

Run: `npm test -- html-to-blocks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts \
        work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts
git commit -m "feat(onboarding-roadmap-sync): html-to-blocks support for tables, images, asides"
```

---

## Task 9: `html-to-blocks` — degraded fallbacks (TDD)

Cover details/summary, wrappers (div/section/article/main), and unknown tags. Wrap unknown content in paragraph fallback so we never lose text silently.

**Files:**
- Modify: `work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts`
- Modify: `work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("htmlToBlocks — degraded fallbacks", () => {
  it("flattens details/summary into paragraph + children", () => {
    const blocks = htmlToBlocks(
      "<details><summary>S</summary><p>P</p></details>",
      "https://x",
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("turns unknown tags into a paragraph with their text", () => {
    const blocks = htmlToBlocks("<custom-tag>Hello</custom-tag>", "https://x");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("ignores empty wrappers", () => {
    expect(htmlToBlocks("<div></div>", "https://x")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npm test -- html-to-blocks`
Expected: FAIL (current `convertElement` returns `[]` for unknown tags, so the "unknown tag" test fails).

- [ ] **Step 3: Modify `convertElement` to add fallbacks (before the final `return []`)**

```ts
  if (tag === "details") {
    const summary = el.find("summary").first();
    const $clone = el.clone();
    $clone.find("summary").remove();
    const summaryRich = richTextOf($, summary as Cheerio<Element>, baseUrl);
    const summaryBlock: Block | null = summaryRich.length > 0 ? paragraphBlock(summaryRich) : null;
    const childBlocks: Block[] = [];
    $clone.children().each((_, child) => {
      childBlocks.push(...convertElement($, $(child) as Cheerio<Element>, baseUrl));
    });
    return summaryBlock ? [summaryBlock, ...childBlocks] : childBlocks;
  }

  if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
    const out: Block[] = [];
    el.children().each((_, child) => {
      out.push(...convertElement($, $(child) as Cheerio<Element>, baseUrl));
    });
    return out;
  }

  const fallbackRich = richTextOf($, el, baseUrl);
  const totalLength = fallbackRich.reduce((n, r) => n + r.plain_text.length, 0);
  return totalLength > 0 ? [paragraphBlock(fallbackRich)] : [];
```

- [ ] **Step 4: Run test to verify they pass**

Run: `npm test -- html-to-blocks`
Expected: PASS (all html-to-blocks tests, including details/unknown/empty fallbacks).

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/html-to-blocks.ts \
        work/scripts/onboarding-roadmap-sync/tests/html-to-blocks.test.ts
git commit -m "feat(onboarding-roadmap-sync): html-to-blocks degraded fallbacks for details/wrappers/unknown"
```

---

## Task 10: `src/docs-fetcher.ts` (TDD with fixtures)

**Files:**
- Test: `work/scripts/onboarding-roadmap-sync/tests/docs-fetcher.test.ts`
- Create: `work/scripts/onboarding-roadmap-sync/tests/fixtures/sidebar.html`
- Create: `work/scripts/onboarding-roadmap-sync/tests/fixtures/page-content.html`
- Create: `work/scripts/onboarding-roadmap-sync/src/docs-fetcher.ts`

- [ ] **Step 1: Capture sidebar fixture from live site**

Run:

```bash
curl -sL "https://avada-development.web.app/training-docs/week-1-warm-up/i01-nodejs_basic/" \
  -o work/scripts/onboarding-roadmap-sync/tests/fixtures/sidebar.html
```

Verify it contains `Week 1 Warm-up`:

```bash
grep -c "Week 1 Warm-up" work/scripts/onboarding-roadmap-sync/tests/fixtures/sidebar.html
```

Expected: `1` or higher.

- [ ] **Step 2: Capture a page content fixture**

Run:

```bash
curl -sL "https://avada-development.web.app/coding-standard-and-best-practice/coding-standard/" \
  -o work/scripts/onboarding-roadmap-sync/tests/fixtures/page-content.html
```

- [ ] **Step 3: Write failing test**

Create `tests/docs-fetcher.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractMainContent, parseSidebar } from "../src/docs-fetcher.ts";

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
    expect(text).toContain("coding standard");
  });

  it("returns empty string when sl-markdown-content missing", () => {
    const text = extractMainContent("<html><body><p>no marker</p></body></html>");
    expect(text).toBe("");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- docs-fetcher`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `src/docs-fetcher.ts`**

```ts
import * as cheerio from "cheerio";

export type SidebarItem = { week: number; title: string; url: string };

export function parseSidebar(
  html: string,
  weekSections: Record<number, string>,
  baseUrl: string,
): SidebarItem[] {
  const $ = cheerio.load(html);
  const labelToWeek = new Map(Object.entries(weekSections).map(([w, l]) => [l, Number(w)]));
  const items: SidebarItem[] = [];
  $("div.container-sidebar-entry").each((_, entry) => {
    const $entry = $(entry);
    const label = $entry.find("h4.entry-title").first().text().trim();
    const week = labelToWeek.get(label);
    if (week === undefined) return;
    $entry.find("a.entry-link").each((_, a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const title = $a.text().trim();
      if (!href || !title) return;
      try {
        items.push({ week, title, url: new URL(href, baseUrl).toString() });
      } catch {
        return;
      }
    });
  });
  return items;
}

export function extractMainContent(html: string): string {
  const $ = cheerio.load(html);
  const content = $("div.sl-markdown-content").first();
  if (content.length === 0) return "";
  return content.text().replace(/\s+/g, " ").trim();
}

export function extractMainHtml(html: string): string {
  const $ = cheerio.load(html);
  const content = $("div.sl-markdown-content").first();
  return content.length === 0 ? "" : content.html() ?? "";
}

export function extractTitle(html: string): string {
  const $ = cheerio.load(html);
  const h1 = $("h1[data-page-title]").first().text().trim();
  if (h1) return h1;
  const fallback = $("h1").first().text().trim();
  return fallback;
}

export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "onboarding-roadmap-sync/0.1" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- docs-fetcher`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/docs-fetcher.ts \
        work/scripts/onboarding-roadmap-sync/tests/docs-fetcher.test.ts \
        work/scripts/onboarding-roadmap-sync/tests/fixtures/sidebar.html \
        work/scripts/onboarding-roadmap-sync/tests/fixtures/page-content.html
git commit -m "feat(onboarding-roadmap-sync): docs-fetcher with sidebar parser and content extractor"
```

---

## Task 11: `src/notion-client.ts` (no Notion mocks)

This module is integration-only — tested indirectly via `--dry-run` smoke runs. Provides typed wrappers around the Notion SDK calls we need.

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/src/notion-client.ts`

- [ ] **Step 1: Implement the module**

```ts
import { Client } from "@notionhq/client";
import {
  NOTION_DB_ID,
  NOTION_PAGE_ID,
  RATE_LIMIT_MS,
  SOURCE_HASH_PROP,
  SOURCE_URL_PROP,
  STATUS_PROP,
  TAG_PROP,
  NAME_PROP,
  DEFAULT_STATUS_FOR_NEW_TASK,
} from "../config.ts";
import { chunkArray, sleep, withRetry } from "./chunking.ts";
import type { Block } from "./html-to-blocks.ts";

export type ExistingTask = { pageId: string; sourceHash: string | null };

export function makeClient(token: string): Client {
  return new Client({ auth: token });
}

export async function ensureDbProperties(client: Client, dbId: string = NOTION_DB_ID): Promise<void> {
  const db = await client.databases.retrieve({ database_id: dbId });
  const props = db.properties as Record<string, { type: string }>;
  const updates: Record<string, unknown> = {};
  if (!(SOURCE_URL_PROP in props)) updates[SOURCE_URL_PROP] = { url: {} };
  if (!(SOURCE_HASH_PROP in props)) updates[SOURCE_HASH_PROP] = { rich_text: {} };
  if (Object.keys(updates).length === 0) return;
  await client.databases.update({ database_id: dbId, properties: updates });
}

export async function indexExistingTasks(
  client: Client,
  dbId: string = NOTION_DB_ID,
): Promise<Map<string, ExistingTask>> {
  const map = new Map<string, ExistingTask>();
  let cursor: string | undefined = undefined;
  do {
    const page = await client.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const row of page.results) {
      if (!("properties" in row)) continue;
      const props = row.properties as Record<string, unknown>;
      const urlProp = props[SOURCE_URL_PROP] as { url?: string | null } | undefined;
      const hashProp = props[SOURCE_HASH_PROP] as
        | { rich_text?: Array<{ plain_text?: string }> }
        | undefined;
      const url = urlProp?.url ?? null;
      if (!url) continue;
      const hash = hashProp?.rich_text?.[0]?.plain_text ?? null;
      if (map.has(url)) continue;
      map.set(url, { pageId: row.id, sourceHash: hash });
    }
    cursor = page.next_cursor ?? undefined;
    await sleep(RATE_LIMIT_MS);
  } while (cursor);
  return map;
}

export async function createTask(
  client: Client,
  args: { dbId?: string; title: string; week: number; sourceUrl: string; sourceHash: string; blocks: Block[] },
): Promise<string> {
  const dbId = args.dbId ?? NOTION_DB_ID;
  const created = await withRetry(() =>
    client.pages.create({
      parent: { database_id: dbId },
      properties: {
        [NAME_PROP]: { title: [{ type: "text", text: { content: args.title } }] },
        [STATUS_PROP]: { status: { name: DEFAULT_STATUS_FOR_NEW_TASK } },
        [TAG_PROP]: { select: { name: `Week ${args.week}` } },
        [SOURCE_URL_PROP]: { url: args.sourceUrl },
        [SOURCE_HASH_PROP]: { rich_text: [{ type: "text", text: { content: args.sourceHash } }] },
      },
    }),
  );
  await sleep(RATE_LIMIT_MS);
  await appendBlocks(client, created.id, args.blocks);
  return created.id;
}

export async function replaceTaskBody(
  client: Client,
  pageId: string,
  blocks: Block[],
  newHash: string,
): Promise<void> {
  const childIds: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    const page = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const child of page.results) childIds.push(child.id);
    cursor = page.next_cursor ?? undefined;
    await sleep(RATE_LIMIT_MS);
  } while (cursor);

  for (const id of childIds) {
    await withRetry(() => client.blocks.delete({ block_id: id }));
    await sleep(RATE_LIMIT_MS);
  }

  await appendBlocks(client, pageId, blocks);

  await withRetry(() =>
    client.pages.update({
      page_id: pageId,
      properties: {
        [SOURCE_HASH_PROP]: { rich_text: [{ type: "text", text: { content: newHash } }] },
      },
    }),
  );
  await sleep(RATE_LIMIT_MS);
}

export async function appendBlocks(client: Client, pageId: string, blocks: Block[]): Promise<void> {
  for (const chunk of chunkArray(blocks, 100)) {
    await withRetry(() =>
      client.blocks.children.append({ block_id: pageId, children: chunk as never }),
    );
    await sleep(RATE_LIMIT_MS);
  }
}

export async function findInlineDatabase(client: Client, pageId: string): Promise<string | null> {
  const result = await client.blocks.children.list({ block_id: pageId, page_size: 100 });
  for (const child of result.results) {
    if ("type" in child && child.type === "child_database") return child.id;
  }
  return null;
}

export async function resetAllTaskStatuses(client: Client, dbId: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined = undefined;
  do {
    const page = await client.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const row of page.results) {
      await withRetry(() =>
        client.pages.update({
          page_id: row.id,
          properties: { [STATUS_PROP]: { status: { name: DEFAULT_STATUS_FOR_NEW_TASK } } },
        }),
      );
      count += 1;
      await sleep(RATE_LIMIT_MS);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return count;
}

export async function renamePage(client: Client, pageId: string, newTitle: string): Promise<void> {
  await withRetry(() =>
    client.pages.update({
      page_id: pageId,
      properties: {
        title: { title: [{ type: "text", text: { content: newTitle } }] },
      },
    }),
  );
  await sleep(RATE_LIMIT_MS);
}

export const PAGE_ID = NOTION_PAGE_ID;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/notion-client.ts
git commit -m "feat(onboarding-roadmap-sync): notion-client wrappers (schema, index, upsert, reset, rename)"
```

---

## Task 12: `src/sync.ts` (batch sync entry)

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/src/sync.ts`

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env tsx
import "dotenv/config";
import { Command } from "commander";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { DOCS_BASE_URL, SIDEBAR_SEED_URL, WEEK_SECTIONS } from "../config.ts";
import {
  ensureDbProperties,
  indexExistingTasks,
  createTask,
  replaceTaskBody,
  makeClient,
} from "./notion-client.ts";
import { extractMainHtml, extractTitle, fetchPage, parseSidebar } from "./docs-fetcher.ts";
import { htmlToBlocks } from "./html-to-blocks.ts";
import { hashContent, normaliseText } from "./matching.ts";
import { log, makeCounters } from "./logger.ts";

loadEnv({ path: resolve(process.cwd(), "../../../.token.env") });

type Options = { dryRun: boolean; force: boolean; week?: number };

async function main(options: Options): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY missing from .token.env");
  const client = makeClient(token);

  log.info("Ensuring DB schema has Source URL + Source Hash...");
  if (!options.dryRun) await ensureDbProperties(client);

  log.info(`Fetching sidebar from ${SIDEBAR_SEED_URL}`);
  const sidebarHtml = await fetchPage(SIDEBAR_SEED_URL);
  let items = parseSidebar(sidebarHtml, WEEK_SECTIONS, DOCS_BASE_URL);
  if (options.week) items = items.filter((i) => i.week === options.week);
  log.info(`Found ${items.length} docs items in scope`);

  log.info("Indexing existing tasks in DB...");
  const existing = options.dryRun ? new Map() : await indexExistingTasks(client);
  const seenUrls = new Set<string>();
  const counters = makeCounters();

  for (const item of items) {
    seenUrls.add(item.url);
    log.info(`→ ${item.title} (Week ${item.week})`);
    const pageHtml = await fetchPage(item.url);
    const mainHtml = extractMainHtml(pageHtml);
    const mainText = normaliseText(extractTitle(pageHtml) + " " + mainHtml.replace(/<[^>]+>/g, " "));
    const newHash = hashContent(mainText);
    const blocks = htmlToBlocks(mainHtml, DOCS_BASE_URL);

    const found = existing.get(item.url);
    if (!found) {
      log.ok(`would create: ${item.title}`);
      if (!options.dryRun) {
        await createTask(client, {
          title: extractTitle(pageHtml) || item.title,
          week: item.week,
          sourceUrl: item.url,
          sourceHash: newHash,
          blocks,
        });
      }
      counters.created += 1;
    } else if (options.force || found.sourceHash !== newHash) {
      log.ok(`would update: ${item.title}`);
      if (!options.dryRun) await replaceTaskBody(client, found.pageId, blocks, newHash);
      counters.updated += 1;
    } else {
      log.info(`skip (no change): ${item.title}`);
      counters.skipped += 1;
    }
  }

  for (const [url] of existing) {
    if (!seenUrls.has(url)) {
      log.warn(`orphan task with Source URL ${url} — present in Notion but not in sidebar`);
      counters.orphans += 1;
    }
  }

  log.summary(counters);
}

const program = new Command();
program
  .option("--dry-run", "log intent without writing to Notion", false)
  .option("--force", "rewrite body for every matched task even if hash is unchanged", false)
  .option("--week <n>", "limit to a single week (1-4)", (v) => Number(v))
  .action((opts: Options) => main(opts).catch((err) => { log.error(String(err)); process.exit(1); }));

program.parse();
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke test in dry-run mode**

Run: `npm run sync -- --dry-run`
Expected: lists Week 1-4 items with "would create" or "would update" labels, does NOT write to Notion. Final summary line printed.

- [ ] **Step 4: Real run, single week**

Run: `npm run sync -- --week 1`
Expected: creates Week 1 tasks the first time, prints `Created N, Updated 0, Skipped 0, Orphans 0`.

- [ ] **Step 5: Re-run same command (idempotency check)**

Run: `npm run sync -- --week 1`
Expected: `Created 0, Updated 0, Skipped N, Orphans 0` (all skipped because hash matches).

- [ ] **Step 6: Verify in Notion UI**

Open the master template page in Notion. Confirm:

- Week 1 tasks present with `Source URL` populated and `Source Hash` populated
- Task body content matches what's on the docs site
- Task `Status` is "Not started"
- No duplicate tasks created on the second run

- [ ] **Step 7: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/sync.ts
git commit -m "feat(onboarding-roadmap-sync): sync command (batch idempotent)"
```

---

## Task 13: `src/add-task.ts` (single-task entry)

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/src/add-task.ts`

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env tsx
import "dotenv/config";
import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { DOCS_BASE_URL } from "../config.ts";
import {
  ensureDbProperties,
  indexExistingTasks,
  createTask,
  replaceTaskBody,
  makeClient,
} from "./notion-client.ts";
import { extractMainHtml, extractTitle, fetchPage } from "./docs-fetcher.ts";
import { htmlToBlocks } from "./html-to-blocks.ts";
import { hashContent, normaliseText } from "./matching.ts";
import { log } from "./logger.ts";

loadEnv({ path: resolve(process.cwd(), "../../../.token.env") });

type Options = { url?: string; week?: number };

async function main(options: Options): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY missing from .token.env");

  const url = options.url ?? (await input({ message: "Docs URL?" }));
  if (!url.startsWith(DOCS_BASE_URL)) {
    throw new Error(`URL must start with ${DOCS_BASE_URL}`);
  }
  const week = options.week ??
    (await select({
      message: "Which week?",
      choices: [1, 2, 3, 4].map((n) => ({ name: `Week ${n}`, value: n })),
    }));

  const client = makeClient(token);
  await ensureDbProperties(client);
  const existing = await indexExistingTasks(client);

  log.info(`Fetching ${url}`);
  const pageHtml = await fetchPage(url);
  const mainHtml = extractMainHtml(pageHtml);
  const title = extractTitle(pageHtml);
  const mainText = normaliseText(title + " " + mainHtml.replace(/<[^>]+>/g, " "));
  const newHash = hashContent(mainText);
  const blocks = htmlToBlocks(mainHtml, DOCS_BASE_URL);

  const found = existing.get(url);
  if (!found) {
    await createTask(client, { title, week, sourceUrl: url, sourceHash: newHash, blocks });
    log.ok(`Created task "${title}" (Week ${week})`);
  } else {
    await replaceTaskBody(client, found.pageId, blocks, newHash);
    log.ok(`Updated body of "${title}"`);
  }
}

const program = new Command();
program
  .option("--url <url>", "docs URL of the task")
  .option("--week <n>", "week 1-4", (v) => Number(v))
  .action((opts: Options) => main(opts).catch((err) => { log.error(String(err)); process.exit(1); }));

program.parse();
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke test (interactive)**

Run: `npm run add-task`
Expected: prompts for URL and week. Pasting a docs URL and choosing Week 2 results in a created/updated task in Notion.

- [ ] **Step 4: Smoke test (flags)**

Run: `npm run add-task -- --url https://avada-development.web.app/development-resources/dev-flow/ --week 3`
Expected: creates the task non-interactively.

- [ ] **Step 5: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/add-task.ts
git commit -m "feat(onboarding-roadmap-sync): add-task command (single URL, interactive fallback)"
```

---

## Task 14: `src/new-dev.ts` (post-duplicate customizer)

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/src/new-dev.ts`

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env tsx
import "dotenv/config";
import { Command } from "commander";
import { input } from "@inquirer/prompts";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { findInlineDatabase, makeClient, renamePage, resetAllTaskStatuses } from "./notion-client.ts";
import { log } from "./logger.ts";

loadEnv({ path: resolve(process.cwd(), "../../../.token.env") });

type Options = { page?: string; name?: string };

function parsePageId(pageInput: string): string {
  const cleaned = pageInput.replace(/-/g, "");
  const match = cleaned.match(/[0-9a-f]{32}/i);
  if (!match) throw new Error(`Could not parse page id from: ${pageInput}`);
  const id = match[0];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function main(options: Options): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY missing from .token.env");

  const pageInput = options.page ?? (await input({ message: "URL of the duplicated Notion page?" }));
  const name = options.name ?? (await input({ message: "Developer's full name?" }));
  if (!name.trim()) throw new Error("Developer name is required");
  const pageId = parsePageId(pageInput);

  const client = makeClient(token);
  const dbId = await findInlineDatabase(client, pageId);
  if (!dbId) throw new Error("No inline database found inside the duplicated page.");

  const newTitle = `[Dev] Onboarding - ${name.trim()}`;
  log.info(`Renaming page → "${newTitle}"`);
  await renamePage(client, pageId, newTitle);

  log.info("Resetting Status of every task to Not started...");
  const count = await resetAllTaskStatuses(client, dbId);
  log.ok(`Done. Renamed page + reset ${count} tasks.`);
}

const program = new Command();
program
  .option("--page <url>", "URL of the duplicated Notion page")
  .option("--name <name>", "developer's full name")
  .action((opts: Options) => main(opts).catch((err) => { log.error(String(err)); process.exit(1); }));

program.parse();
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

In Notion UI, duplicate the master page (`...` → Duplicate). Copy the duplicated page's URL.

Run: `npm run new-dev -- --page <copied-url> --name "Test Dev"`

Expected:

- duplicated page renamed to `[Dev] Onboarding - Test Dev`
- every task in its inline DB has Status = `Not started`
- console prints `Done. Renamed page + reset N tasks.`

After verifying in Notion UI, archive the test duplicate (manually).

- [ ] **Step 4: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/src/new-dev.ts
git commit -m "feat(onboarding-roadmap-sync): new-dev command (rename + reset Status on duplicate)"
```

---

## Task 15: `README.md`

**Files:**
- Create: `work/scripts/onboarding-roadmap-sync/README.md`

- [ ] **Step 1: Write README**

```markdown
# onboarding-roadmap-sync

Mirrors the X Team docs-site onboarding roadmap (Week 1–4) into the Notion master template **"[Dev] Onboarding - AOV.ai"**, supports per-task add/update, and customises duplicated copies for new developers.

- Design: [docs/design.md](docs/design.md)
- Plan: [docs/plan.md](docs/plan.md)

## Quick start

\`\`\`bash
git clone <repo> && cd <repo>/work/scripts/onboarding-roadmap-sync
npm install
\`\`\`

Setup once per machine:

1. Workspace-root `.token.env` must contain `NOTION_API_KEY` (the same `X Team` integration used by `notion-sheets-sync`).
2. In Notion UI, the lead opens the master template page → `...` → `Connections` → adds `X Team`.

Verify reachability:

\`\`\`bash
npm run sync -- --dry-run
\`\`\`

## Commands

| Command | Purpose |
| --- | --- |
| `npm run sync` | Batch sync Week 1–4 docs pages into the master template (idempotent). |
| `npm run sync -- --dry-run` | Log intent without writing to Notion. |
| `npm run sync -- --force` | Rewrite body of every matched task even if hash unchanged. |
| `npm run sync -- --week N` | Limit batch sync to a single week (1–4). |
| `npm run add-task -- --url <docs-url> --week <N>` | Add or refresh one task. Prompts when flags missing. |
| `npm run new-dev -- --page <duplicated-page-url> --name "<dev name>"` | Customise a Notion-duplicated copy of the master template. Renames title and resets all Status to `Not started`. |
| `npm test` | Unit tests (cheerio fixture-based, no Notion calls). |
| `npm run typecheck` | TypeScript compile check. |

## Provisioning a new developer

1. In Notion UI, open the master template → `...` → **Duplicate**. Notion clones the inline DB and every task page faithfully.
2. Copy the duplicated page's URL.
3. Run `npm run new-dev -- --page <copied-url> --name "Anh Nguyen"`.
4. In Notion UI, share the new page with the developer (Notion API can't share pages on behalf of an integration).

## How sync works

The tool fetches the docs-site sidebar from `SIDEBAR_SEED_URL` (a known training-docs page; the docs homepage doesn't render the Week sidebar), parses Week 1–4 entries, and for each docs URL:

- If no Notion task with that `Source URL` exists → create one (Name from docs page title, Week tag, Status `Not started`).
- If one exists and `Source Hash` differs → wipe its body, append new blocks, update the hash. **Never** touches Status, tag, or Name.
- If one exists and the hash matches → skip.

Tasks left in the DB whose `Source URL` is no longer in the sidebar are logged as `orphans` (not auto-archived — the lead resolves manually).

## Source layout

See [docs/design.md](docs/design.md) for the full architecture spec.
```

> When writing the README, replace the escaped triple-backticks (`\`\`\``) above with real triple-backticks. They are escaped here so this plan file remains valid markdown.

- [ ] **Step 2: Final end-to-end smoke**

Run: `npm run sync` (full Week 1–4)
Expected: prints summary; verify in Notion UI that all expected tasks exist with correct Week tags and body content.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/onboarding-roadmap-sync/README.md
git commit -m "docs(onboarding-roadmap-sync): add README with quick start and command reference"
```

---

## Self-review checklist (already applied — fix inline if you spot anything)

- **Spec coverage**:
  - §4 Architecture → Tasks 1–15 cover all modules
  - §5 Configuration → Task 2
  - §6 Data model + merge rules → Tasks 11 (`ensureDbProperties`, `indexExistingTasks`) and 12 (sync logic)
  - §7.1 `sync` → Task 12
  - §7.2 `add-task` → Task 13
  - §7.3 `new-dev` → Task 14
  - §8 HTML→Notion mapping → Tasks 6–9
  - §9 Body update strategy → Task 11 `replaceTaskBody`
  - §10 Error handling → Tasks 4 (`withRetry`), 12/13/14 (top-level catch + clear errors)
  - §11 File structure → covered across all tasks
  - §12 Dependencies → Task 1
  - §13 Testing strategy → Tasks 4, 5, 6–9, 10 (unit tests with fixtures); 12/13/14 use manual `--dry-run` smoke
  - §14 Setup for team members → Task 15 (README)
- **Placeholder scan**: no `TBD`/`TODO`/`add appropriate error handling`/`fill in details` left in the plan.
- **Type consistency**: `Block` exported from `html-to-blocks.ts`, consumed by `notion-client.ts`. `SidebarItem` returned by `parseSidebar` and consumed in `sync.ts`. `ExistingTask` from `notion-client` consumed where indexing is read.
