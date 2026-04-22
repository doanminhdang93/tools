const NOTION_BASE_URL = "https://www.notion.so";
const PAGE_ID_IN_URL_PATTERN = /([0-9a-f]{32})(?:[?#]|$)/i;

export function buildNotionUrl(pageId: string): string {
  const cleanId = pageId.replace(/-/g, "").toLowerCase();
  return `${NOTION_BASE_URL}/${cleanId}`;
}

export function extractPageIdFromUrl(notionUrl: string): string | null {
  const match = notionUrl.match(PAGE_ID_IN_URL_PATTERN);
  if (!match) return null;
  return match[1].toLowerCase();
}

export function normalizeNotionPageId(pageIdWithOrWithoutDashes: string): string {
  return pageIdWithOrWithoutDashes.replace(/-/g, "").toLowerCase();
}
