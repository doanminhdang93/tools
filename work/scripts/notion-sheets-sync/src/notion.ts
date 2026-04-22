import { Client } from "@notionhq/client";

export interface NotionPage {
  id: string;
  properties: Record<string, { type: string; [key: string]: unknown }>;
}

const NOTION_PAGE_SIZE = 100;

export async function fetchAllPages(
  notionApiKey: string,
  databaseId: string,
): Promise<NotionPage[]> {
  const client = new Client({ auth: notionApiKey });
  const collected: NotionPage[] = [];
  let pageCursor: string | undefined = undefined;

  do {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: pageCursor,
      page_size: NOTION_PAGE_SIZE,
    });

    for (const result of response.results) {
      if (!("properties" in result)) continue;
      collected.push({
        id: result.id,
        properties: result.properties as NotionPage["properties"],
      });
    }

    pageCursor = response.next_cursor ?? undefined;
  } while (pageCursor);

  return collected;
}

export function filterByAssignee(
  pages: NotionPage[],
  assigneeName: string,
): NotionPage[] {
  return pages.filter((page) => pageHasAssignee(page, assigneeName));
}

function pageHasAssignee(page: NotionPage, assigneeName: string): boolean {
  const assigneeProperty = page.properties["Assignee"];
  if (!assigneeProperty || assigneeProperty.type !== "people") return false;

  const people = (assigneeProperty as { people?: { name?: string | null }[] }).people;
  if (!Array.isArray(people)) return false;

  return people.some((person) => person.name === assigneeName);
}
