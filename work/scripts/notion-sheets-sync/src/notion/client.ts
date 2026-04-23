import { Client } from "@notionhq/client";

export interface NotionPage {
  id: string;
  properties: Record<string, { type: string; [key: string]: unknown }>;
}

const NOTION_PAGE_SIZE = 100;
const ASSIGNEE_FIELD = "Assignee";

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
  personName: string,
): NotionPage[] {
  return pages.filter((page) => assigneeNamesOnPage(page).includes(personName));
}

export function collectAssigneeNames(pages: NotionPage[]): Set<string> {
  const names = new Set<string>();
  for (const page of pages) {
    for (const name of assigneeNamesOnPage(page)) {
      names.add(name);
    }
  }
  return names;
}

function assigneeNamesOnPage(page: NotionPage): string[] {
  const property = page.properties[ASSIGNEE_FIELD];
  if (!property || property.type !== "people") return [];

  const people = (property as { people?: { name?: string | null }[] }).people;
  if (!Array.isArray(people)) return [];

  return people
    .map((person) => person.name ?? "")
    .filter((name) => name.length > 0);
}
