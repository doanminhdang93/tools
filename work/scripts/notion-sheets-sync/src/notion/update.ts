import type { Client as NotionClient } from "@notionhq/client";
import type { NotionPage } from "./client.ts";
import type { PointSource } from "./fields.ts";
import type { Logger } from "../logger.ts";
import { withRetry } from "../util/retry.ts";

const POINT_FIELD_NAME: Record<PointSource, string> = {
  story_point: "Story Point",
  size_card: "Size Card",
};

export interface PushPointArgs {
  client: NotionClient;
  page: NotionPage;
  point: number;
  source: PointSource;
}

export interface NotionUpdateResult {
  ok: boolean;
  reason?: string;
}

export interface PushDoneDateArgs {
  client: NotionClient;
  page: NotionPage;
  doneDate: string;
}

const DONE_DATE_FIELD = "Done date";

export async function pushDoneDateToNotion(args: PushDoneDateArgs): Promise<NotionUpdateResult> {
  try {
    await withRetry(
      () => args.client.pages.update({
        page_id: args.page.id,
        properties: {
          [DONE_DATE_FIELD]: { date: { start: args.doneDate } },
        } as Parameters<NotionClient["pages"]["update"]>[0]["properties"],
      }),
      { label: `notion.pages.update ${DONE_DATE_FIELD}` },
    );
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message };
  }
}

export interface PointPushIntent {
  page: NotionPage;
  point: number;
  field: PointSource;
}

export interface PushPointIntentsArgs {
  client: NotionClient;
  intents: PointPushIntent[];
  tabName: string;
  logger: Logger;
}

export async function pushPointIntents(args: PushPointIntentsArgs): Promise<void> {
  const { client, intents, tabName, logger } = args;
  if (intents.length === 0) return;

  logger.info(`[${tabName}] pushing ${intents.length} sheet-overridden point(s) back to Notion`);
  for (const intent of intents) {
    const result = await pushPointToNotion({
      client,
      page: intent.page,
      point: intent.point,
      source: intent.field,
    });
    const fieldLabel = POINT_FIELD_NAME[intent.field];
    const shortId = intent.page.id.slice(0, 8);
    if (!result.ok) {
      logger.warn(`[${tabName}]   ✗ ${shortId} ${fieldLabel}=${intent.point} failed: ${result.reason}`);
      continue;
    }
    // Later tabs in the same run read these pages again; keep the in-memory copy
    // in step with Notion so they don't re-push the value we just wrote.
    applyPushedPointToPage(intent.page, intent.field, intent.point);
    logger.info(`[${tabName}]   ✔ ${shortId} → ${fieldLabel}=${intent.point}`);
  }
}

function applyPushedPointToPage(page: NotionPage, field: PointSource, newPoint: number): void {
  const propertyName = POINT_FIELD_NAME[field];
  const existingProperty = page.properties[propertyName];
  if (existingProperty?.type === "number") {
    page.properties[propertyName] = {
      type: "number",
      number: newPoint,
    } as NotionPage["properties"][string];
    return;
  }
  page.properties[propertyName] = {
    type: "select",
    select: { name: String(newPoint) },
  } as NotionPage["properties"][string];
}

export async function pushPointToNotion(args: PushPointArgs): Promise<NotionUpdateResult> {
  const fieldName = POINT_FIELD_NAME[args.source];
  const existingProperty = args.page.properties[fieldName];
  const propertyValue = buildPropertyValue(existingProperty, args.point);
  try {
    await args.client.pages.update({
      page_id: args.page.id,
      properties: {
        [fieldName]: propertyValue,
      } as Parameters<NotionClient["pages"]["update"]>[0]["properties"],
    });
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message };
  }
}

function buildPropertyValue(
  existingProperty: NotionPage["properties"][string] | undefined,
  point: number,
): { number: number } | { select: { name: string } } {
  if (existingProperty?.type === "number") {
    return { number: point };
  }
  return { select: { name: String(point) } };
}
