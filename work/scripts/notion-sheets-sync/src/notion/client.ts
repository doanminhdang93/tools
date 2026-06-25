import { Client } from "@notionhq/client";
import { withRetry } from "../util/retry.ts";

export interface NotionPage {
  id: string;
  properties: Record<string, { type: string; [key: string]: unknown }>;
}

const NOTION_PAGE_SIZE = 100;
const ASSIGNEE_FIELD = "Assignee";

export interface FetchPagesOptions {
  createdOnOrAfter?: Date;
}

export async function fetchAllPages(
  notionApiKey: string,
  databaseId: string,
  options: FetchPagesOptions = {},
): Promise<NotionPage[]> {
  const client = new Client({ auth: notionApiKey });
  const collected: NotionPage[] = [];
  let trashedSkipped = 0;
  let pageCursor: string | undefined = undefined;

  const filter = options.createdOnOrAfter
    ? {
        timestamp: "created_time" as const,
        created_time: { on_or_after: options.createdOnOrAfter.toISOString() },
      }
    : undefined;

  do {
    const response = await withRetry(
      () => client.databases.query({
        database_id: databaseId,
        start_cursor: pageCursor,
        page_size: NOTION_PAGE_SIZE,
        ...(filter ? { filter } : {}),
      }),
      {
        label: "notion.databases.query",
        onRetry: (attempt, cause) => {
          console.warn(`[notion] query attempt ${attempt} failed: ${cause.message} — retrying`);
        },
      },
    );

    for (const result of response.results) {
      if (!("properties" in result)) continue;
      if (isPageTrashed(result as { archived?: boolean; in_trash?: boolean })) {
        trashedSkipped++;
        continue;
      }
      collected.push({
        id: result.id,
        properties: result.properties as NotionPage["properties"],
      });
    }

    pageCursor = response.next_cursor ?? undefined;
  } while (pageCursor);

  if (trashedSkipped > 0) {
    console.log(`[notion] skipped ${trashedSkipped} trashed/archived page(s)`);
  }
  return collected;
}

function isPageTrashed(result: { archived?: boolean; in_trash?: boolean }): boolean {
  return result.archived === true || result.in_trash === true;
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
