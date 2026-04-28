import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { fetchAllPages } from "../src/notion/client.ts";
import { syncTab } from "../src/sync.ts";
import { createSheetsClient } from "../src/sheets/client.ts";
import { createLogger } from "../src/logger.ts";
import { readMembers } from "../src/util/members.ts";
import { overrides } from "../tabs.config.ts";
import { kpiWindowStart } from "../src/util/month.ts";
import type { PointSource } from "../src/notion/fields.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TAB = process.argv[2];
const MONTH = process.argv[3];
const WINDOW_END_ISO = process.argv[4];

if (!TAB || !MONTH || !WINDOW_END_ISO) {
  console.error("Usage: tsx commands/sync-tab-window.ts <Tab> <M/YYYY> <WindowEndISO>");
  console.error("  Example: tsx commands/sync-tab-window.ts VuTV 3/2026 2026-04-08T16:59:59.999Z");
  process.exit(1);
}

const STORY_POINT_ROLES = new Set(["po", "designer"]);

async function main() {
  const appConfig = loadConfig();
  const logger = createLogger({
    slackBotToken: appConfig.slackBotToken,
    notifyChannel: appConfig.notifyOnErrorChannel,
  });

  const members = await readMembers();
  const member = members.find((m) => m.tabName === TAB);
  if (!member) throw new Error(`Tab "${TAB}" not in Members`);

  const reverseOverride = Object.entries(overrides).find(([, tab]) => tab === member.tabName);
  const notionName = reverseOverride?.[0] ?? member.fullName;
  const role = member.role;
  const pointSource: PointSource = STORY_POINT_ROLES.has(role.trim().toLowerCase())
    ? "story_point"
    : "size_card";

  const windowEnd = new Date(WINDOW_END_ISO);
  if (Number.isNaN(windowEnd.getTime())) throw new Error(`Bad ISO: ${WINDOW_END_ISO}`);

  const windowStart = kpiWindowStart(MONTH);
  logger.info(`Custom window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);

  const allPages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, {
    createdOnOrAfter: windowStart,
  });
  logger.info(`Fetched ${allPages.length} pages.`);

  const sheets = createSheetsClient(appConfig.googleServiceAccountKeyFile, appConfig.googleSheetsId);
  await syncTab({
    tabName: TAB,
    assigneeName: notionName,
    allPages,
    sheets,
    logger,
    targetMonthOverride: MONTH,
    windowEndOverride: windowEnd,
    pointSource,
    role,
  });
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
