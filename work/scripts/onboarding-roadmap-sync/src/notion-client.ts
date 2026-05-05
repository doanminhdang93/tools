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
  TIME_PROP,
  ASSIGNEE_PROP,
  FOLLOWER_PROP,
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
  if (!(TIME_PROP in props)) updates[TIME_PROP] = { date: {} };
  if (!(ASSIGNEE_PROP in props)) updates[ASSIGNEE_PROP] = { people: {} };
  if (!(FOLLOWER_PROP in props)) updates[FOLLOWER_PROP] = { people: {} };
  if (Object.keys(updates).length === 0) return;
  await client.databases.update({ database_id: dbId, properties: updates as never });
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
      } as never,
    }),
  );
  await sleep(RATE_LIMIT_MS);
  await appendBlocks(client, created.id, args.blocks);
  return created.id;
}

async function deleteBlockIdempotent(client: Client, blockId: string): Promise<void> {
  try {
    await withRetry(() => client.blocks.delete({ block_id: blockId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("archived")) return;
    throw error;
  }
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
    await deleteBlockIdempotent(client, id);
    await sleep(RATE_LIMIT_MS);
  }

  await appendBlocks(client, pageId, blocks);

  await withRetry(() =>
    client.pages.update({
      page_id: pageId,
      properties: {
        [SOURCE_HASH_PROP]: { rich_text: [{ type: "text", text: { content: newHash } }] },
      } as never,
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

export async function replacePageIntro(
  client: Client,
  pageId: string,
  newIntroBlocks: Block[],
): Promise<void> {
  const children: Array<{ id: string; type: string }> = [];
  let cursor: string | undefined = undefined;
  do {
    const page = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const child of page.results) {
      if ("type" in child) children.push({ id: child.id, type: child.type });
    }
    cursor = page.next_cursor ?? undefined;
    await sleep(RATE_LIMIT_MS);
  } while (cursor);

  const dbIndex = children.findIndex((c) => c.type === "child_database");
  const introIds = dbIndex < 0
    ? children.map((c) => c.id)
    : children.slice(0, dbIndex).map((c) => c.id);
  const anchorId = introIds.length > 0 ? introIds[introIds.length - 1] : undefined;

  for (const chunk of chunkArray(newIntroBlocks, 100)) {
    await withRetry(() =>
      client.blocks.children.append({
        block_id: pageId,
        children: chunk as never,
        ...(anchorId ? { after: anchorId } : {}),
      }),
    );
    await sleep(RATE_LIMIT_MS);
  }

  for (const id of introIds) {
    await deleteBlockIdempotent(client, id);
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
          properties: { [STATUS_PROP]: { status: { name: DEFAULT_STATUS_FOR_NEW_TASK } } } as never,
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
      } as never,
    }),
  );
  await sleep(RATE_LIMIT_MS);
}

export const PAGE_ID = NOTION_PAGE_ID;
