import type { Client as NotionClient } from "@notionhq/client";
import type { NotionPage } from "./client.ts";
import type { PointSource } from "./fields.ts";

export interface PushPointArgs {
  client: NotionClient;
  page: NotionPage;
  point: number;
  source: PointSource;
}

export interface PushPointResult {
  ok: boolean;
  reason?: string;
}

export async function pushPointToNotion(args: PushPointArgs): Promise<PushPointResult> {
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
