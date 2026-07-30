import type { Client as NotionClient } from "@notionhq/client";
import type { NotionPage } from "./client.ts";
import { doneDateOf } from "./fields.ts";
import { pushDoneDateToNotion } from "./update.ts";
import type { Logger } from "../logger.ts";

export interface StampDoneDatesArgs {
  client: NotionClient;
  pages: NotionPage[];
  doneAt: Date;
  logger: Logger;
}

// Every task written to the sheet in this run gets its Notion "Done date" set
// to the moment sync was triggered — but only when the field is still empty, so
// the first stamp survives later syncs.
export async function stampDoneDates(args: StampDoneDatesArgs): Promise<number> {
  if (args.pages.length === 0) {
    args.logger.info("Done date: no synced tasks to stamp");
    return 0;
  }

  const pagesMissingDoneDate = args.pages.filter((page) => doneDateOf(page) === "");
  if (pagesMissingDoneDate.length === 0) {
    args.logger.info(`Done date: all ${args.pages.length} synced task(s) already have one`);
    return 0;
  }

  args.logger.info(
    `Done date: stamping ${pagesMissingDoneDate.length} synced task(s) with ${args.doneAt.toISOString()}`,
  );

  let stamped = 0;
  for (const page of pagesMissingDoneDate) {
    const result = await pushDoneDateToNotion({
      client: args.client,
      page,
      doneAt: args.doneAt,
    });
    const shortId = page.id.slice(0, 8);
    if (!result.ok) {
      args.logger.warn(`  ✗ ${shortId} Done date failed: ${result.reason}`);
      continue;
    }
    stamped++;
  }

  args.logger.info(`Done date: set on ${stamped}/${pagesMissingDoneDate.length} task(s)`);
  return stamped;
}
