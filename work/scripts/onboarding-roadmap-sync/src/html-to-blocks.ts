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
  const next: Annotations = { ...anno };
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

function detectLanguage(rawCandidate: string | undefined): string {
  if (!rawCandidate) return "plain text";
  const fromClass = rawCandidate.match(/language-([a-zA-Z0-9+#-]+)/);
  const raw = (fromClass ? fromClass[1] : rawCandidate).toLowerCase().trim();
  if (!raw) return "plain text";
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

const ASIDE_ICONS: Record<string, string> = {
  note: "💡",
  tip: "✅",
  caution: "⚠️",
  danger: "🛑",
};

function detectAsideKind(className: string | undefined): string | null {
  if (!className) return null;
  const m = className.match(/starlight-aside--([a-z]+)/);
  return m ? m[1] : null;
}

function convertTable($: cheerio.CheerioAPI, el: Cheerio<Element>, baseUrl: string): Block {
  const rows: Cheerio<Element>[] = [];
  el.find("tr").each((_, tr) => {
    rows.push($(tr) as Cheerio<Element>);
  });
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

function convertCode($: cheerio.CheerioAPI, el: Cheerio<Element>): Block {
  const codeEl = el.find("code").first();
  const language = detectLanguage(el.attr("data-language") ?? codeEl.attr("class"));
  // Starlight Expressive Code wraps each line in <div class="ec-line">.
  // cheerio's .text() concatenates without newlines, so reconstruct line-by-line.
  const ecLines = codeEl.find("div.ec-line");
  let text: string;
  if (ecLines.length > 0) {
    const lines: string[] = [];
    ecLines.each((_, line) => {
      lines.push($(line).text());
    });
    text = lines.join("\n");
  } else {
    text = codeEl.text();
  }
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

const MAX_RICH_TEXT_PER_BLOCK = 100;

const RICH_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
]);

function splitBlockByRichTextLimit(block: Block): Block[] {
  if (!RICH_TEXT_BLOCK_TYPES.has(block.type)) return [block];
  const inner = block[block.type] as { rich_text?: RichText[] } | undefined;
  if (!inner?.rich_text || inner.rich_text.length <= MAX_RICH_TEXT_PER_BLOCK) return [block];
  const parts: Block[] = [];
  for (let i = 0; i < inner.rich_text.length; i += MAX_RICH_TEXT_PER_BLOCK) {
    const slice = inner.rich_text.slice(i, i + MAX_RICH_TEXT_PER_BLOCK);
    parts.push({
      ...block,
      [block.type]: { ...inner, rich_text: slice },
    });
  }
  return parts;
}

export function htmlToBlocks(html: string, baseUrl: string): Block[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const root = $("#root");
  const blocks: Block[] = [];
  root.children().each((_, el) => {
    blocks.push(...convertElement($, $(el) as Cheerio<Element>, baseUrl));
  });
  return blocks.flatMap(splitBlockByRichTextLimit);
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
  if (tag === "ul") return convertList($, el, baseUrl, false);
  if (tag === "ol") return convertList($, el, baseUrl, true);
  if (tag === "pre") return [convertCode($, el)];
  if (tag === "table") return [convertTable($, el, baseUrl)];
  if (tag === "img") {
    const img = convertImage(el, baseUrl);
    return img ? [img] : [];
  }
  if (tag === "aside") return [convertAside($, el, baseUrl)];

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

  if (tag === "figure") {
    const out: Block[] = [];
    el.children().each((_, child) => {
      const childTag = (child as Element).tagName.toLowerCase();
      if (childTag === "figcaption") return;
      if (childTag === "div" && ($(child).attr("class") ?? "").includes("copy")) return;
      out.push(...convertElement($, $(child) as Cheerio<Element>, baseUrl));
    });
    return out;
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
}
