import type { Client as NotionClient } from "@notionhq/client";
import type { NotionPage } from "./client.ts";
import { doneDateOf } from "./fields.ts";
import { pushDoneDateToNotion } from "./update.ts";
import { lastDayOfMonth } from "../util/month.ts";
import type { Logger } from "../logger.ts";

export interface DoneDateTarget {
  page: NotionPage;
  monthLabel: string;
}

export interface StampDoneDatesArgs {
  client: NotionClient;
  targets: DoneDateTarget[];
  logger: Logger;
}

// Every task written to the sheet in this run gets its Notion "Done date" set
// to the last day of the month section it landed in (sync 7/2026 → 2026-07-31),
// but only when the field is still empty, so an existing date is never moved.
export async function stampDoneDates(args: StampDoneDatesArgs): Promise<number> {
  if (args.targets.length === 0) {
    args.logger.info("Done date: no synced tasks to stamp");
    return 0;
  }

  const targetsMissingDoneDate = args.targets.filter((target) => doneDateOf(target.page) === "");
  if (targetsMissingDoneDate.length === 0) {
    args.logger.info(`Done date: all ${args.targets.length} synced task(s) already have one`);
    return 0;
  }

  args.logger.info(
    `Done date: stamping ${targetsMissingDoneDate.length} synced task(s) with their section's month-end date`,
  );

  let stamped = 0;
  for (const target of targetsMissingDoneDate) {
    const doneDate = lastDayOfMonth(target.monthLabel);
    const result = await pushDoneDateToNotion({
      client: args.client,
      page: target.page,
      doneDate,
    });
    const shortId = target.page.id.slice(0, 8);
    if (!result.ok) {
      args.logger.warn(`  ✗ ${shortId} Done date=${doneDate} failed: ${result.reason}`);
      continue;
    }
    stamped++;
  }

  args.logger.info(`Done date: set on ${stamped}/${targetsMissingDoneDate.length} task(s)`);
  return stamped;
}
