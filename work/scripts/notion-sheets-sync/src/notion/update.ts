import type { Client as NotionClient } from "@notionhq/client";
import type { NotionPage } from "./client.ts";
import type { PointSource } from "./fields.ts";
import { withRetry } from "../util/retry.ts";
import { vietnamIsoString } from "../util/month.ts";

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
  doneAt: Date;
}

const DONE_DATE_FIELD = "Done date";

export async function pushDoneDateToNotion(args: PushDoneDateArgs): Promise<NotionUpdateResult> {
  try {
    await withRetry(
      () => args.client.pages.update({
        page_id: args.page.id,
        properties: {
          [DONE_DATE_FIELD]: { date: { start: vietnamIsoString(args.doneAt) } },
        } as Parameters<NotionClient["pages"]["update"]>[0]["properties"],
      }),
      { label: `notion.pages.update ${DONE_DATE_FIELD}` },
    );
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message };
  }
}

export async function pushPointToNotion(args: PushPointArgs): Promise<NotionUpdateResult> {
  const fieldName = args.source === "story_point" ? "Story Point" : "Size Card";
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
