import type { Client as NotionClient } from "@notionhq/client";
import type { PointSource } from "./fields.ts";

export interface PushPointArgs {
  client: NotionClient;
  pageId: string;
  point: number;
  source: PointSource;
}

export interface PushPointResult {
  ok: boolean;
  reason?: string;
}

export async function pushPointToNotion(args: PushPointArgs): Promise<PushPointResult> {
  const fieldName = args.source === "story_point" ? "Story Point" : "Size Card";
  const optionName = String(args.point);
  try {
    await args.client.pages.update({
      page_id: args.pageId,
      properties: {
        [fieldName]: { select: { name: optionName } },
      } as Parameters<NotionClient["pages"]["update"]>[0]["properties"],
    });
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message };
  }
}
