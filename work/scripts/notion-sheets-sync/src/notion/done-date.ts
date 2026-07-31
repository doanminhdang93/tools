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

// A Done date is written when it is missing, or when it points at a different
// month than the sheet section the task sits in (sync 7/2026 → 2026-07-31). A
// date already inside the right month is left alone: re-stamping every task on
// every run would churn "Last edited time" across the whole database hourly.
export function needsDoneDateRestamp(currentDoneDate: string, wantedDoneDate: string): boolean {
  if (currentDoneDate === "") return true;
  return currentDoneDate.slice(0, "YYYY-MM".length) !== wantedDoneDate.slice(0, "YYYY-MM".length);
}

export async function stampDoneDates(args: StampDoneDatesArgs): Promise<number> {
  if (args.targets.length === 0) {
    args.logger.info("Done date: no synced tasks to stamp");
    return 0;
  }

  const pending: { target: DoneDateTarget; doneDate: string; wasEmpty: boolean }[] = [];
  for (const target of args.targets) {
    const currentDoneDate = doneDateOf(target.page);
    const doneDate = lastDayOfMonth(target.monthLabel);
    if (!needsDoneDateRestamp(currentDoneDate, doneDate)) continue;
    pending.push({ target, doneDate, wasEmpty: currentDoneDate === "" });
  }

  if (pending.length === 0) {
    args.logger.info(`Done date: all ${args.targets.length} synced task(s) already match their section's month`);
    return 0;
  }

  const emptyCount = pending.filter((entry) => entry.wasEmpty).length;
  args.logger.info(
    `Done date: writing ${pending.length} task(s) — ${emptyCount} empty, ${pending.length - emptyCount} pointing at the wrong month`,
  );

  let stamped = 0;
  for (const entry of pending) {
    const result = await pushDoneDateToNotion({
      client: args.client,
      page: entry.target.page,
      doneDate: entry.doneDate,
    });
    const shortId = entry.target.page.id.slice(0, 8);
    if (!result.ok) {
      args.logger.warn(`  ✗ ${shortId} Done date=${entry.doneDate} failed: ${result.reason}`);
      continue;
    }
    stamped++;
  }

  args.logger.info(`Done date: set on ${stamped}/${pending.length} task(s)`);
  return stamped;
}
