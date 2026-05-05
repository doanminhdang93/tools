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
  return [];
}
