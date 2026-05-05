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
