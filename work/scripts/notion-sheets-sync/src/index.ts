import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { fetchAllPages } from "./notion/client.ts";
import { createSheetsClient } from "./sheets/client.ts";
import { createLogger, type Logger } from "./logger.ts";
import { syncTab } from "./sync.ts";
import { syncTesterTab } from "./sync-tester.ts";
import { firstInstantOfMonth, previousMonthLabel, currentMonthLabel } from "./util/month.ts";
import { overrides } from "../tabs.config.ts";
import { readMembers, type Member } from "./util/members.ts";
import type { PointSource } from "./notion/fields.ts";

const ROOT_TOKEN_ENV_PATH = resolve(import.meta.dirname, "../../../../.token.env");
loadDotenv({ path: ROOT_TOKEN_ENV_PATH });

const MONTH_LABEL_PATTERN = /^\d{1,2}\/\d{4}$/;

const STORY_POINT_ROLES = new Set(["po", "designer"]);
const SKIP_ROLES = new Set(["pm"]);
const TESTER_ROLE = "tester";

interface ParsedArguments {
  tabName?: string;
  syncAll: boolean;
  cronMode: boolean;
  monthLabel?: string;
  role?: string;
}

function parseCliArguments(argv: string[]): ParsedArguments {
  const args = argv.slice(2);
  const parsed: ParsedArguments = { syncAll: false, cronMode: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") { parsed.syncAll = true; continue; }
    if (arg === "--cron") { parsed.cronMode = true; continue; }
    if (arg === "--tab") { parsed.tabName = args[++i]; continue; }
    if (arg === "--month") { parsed.monthLabel = args[++i]; continue; }
    if (arg === "--role") { parsed.role = args[++i]; continue; }
    if (arg.startsWith("--")) continue;
    if (!parsed.tabName) parsed.tabName = arg;
  }

  return parsed;
}

function applyCronDefault(parsed: ParsedArguments, syncCronTab: string | undefined): void {
  if (!parsed.cronMode) return;
  if (parsed.syncAll || parsed.tabName || parsed.role) return;
  const trimmed = syncCronTab?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") {
    parsed.syncAll = true;
    return;
  }
  parsed.tabName = trimmed;
}

function validateMonthLabel(parsed: ParsedArguments, logger: Logger): boolean {
  if (!parsed.monthLabel) return true;
  if (!MONTH_LABEL_PATTERN.test(parsed.monthLabel)) {
    logger.error(`--month must be M/YYYY (e.g. 3/2026), got: "${parsed.monthLabel}"`);
    return false;
  }
  const month = Number(parsed.monthLabel.split("/")[0]);
  if (month < 1 || month > 12) {
    logger.error(`--month rejected: month out of range in "${parsed.monthLabel}"`);
    return false;
  }
  return true;
}

function pickTargetMembers(parsed: ParsedArguments, members: Member[], logger: Logger): Member[] | null {
  const syncable = members.filter((member) => !SKIP_ROLES.has(member.role.trim().toLowerCase()));

  if (parsed.tabName) {
    const match = syncable.find((member) => member.tabName === parsed.tabName);
    if (!match) {
      logger.error(`Tab "${parsed.tabName}" not found among syncable members. Available: ${syncable.map((m) => m.tabName).join(", ")}`);
      return null;
    }
    return [match];
  }

  if (parsed.role) {
    const wanted = parsed.role.trim().toLowerCase();
    const filtered = syncable.filter((member) => member.role.trim().toLowerCase() === wanted);
    if (filtered.length === 0) {
      logger.error(`No members with role "${parsed.role}". Roles present: ${[...new Set(members.map((m) => m.role))].join(", ")}`);
      return null;
    }
    return filtered;
  }

  if (parsed.syncAll) return syncable;

  logger.error("Usage: npm run sync -- [--month M/YYYY] [--tab <Name> | --role <Role> | --all]");
  return null;
}

function pointSourceForRole(role: string): PointSource {
  return STORY_POINT_ROLES.has(role.trim().toLowerCase()) ? "story_point" : "size_card";
}

function notionDisplayNameFor(member: Member): string {
  const reverse = Object.entries(overrides).find(([, tab]) => tab === member.tabName);
  return reverse?.[0] ?? member.fullName;
}

function targetSortOrder(role: string): number {
  const normalized = role.trim().toLowerCase();
  if (normalized === TESTER_ROLE) return 1;
  return 0;
}

function earliestCreatedFetchFloor(monthOverride: string | undefined, now: Date): Date {
  if (monthOverride) return firstInstantOfMonth(previousMonthLabel(monthOverride));
  const previous = previousMonthLabel(currentMonthLabel(now));
  const twoMonthsBack = previousMonthLabel(previous);
  return firstInstantOfMonth(twoMonthsBack);
}

async function main(): Promise<void> {
  const appConfig = loadConfig();
  const logger = createLogger({
    slackBotToken: appConfig.slackBotToken,
    notifyChannel: appConfig.notifyOnErrorChannel,
  });

  const parsed = parseCliArguments(process.argv);
  applyCronDefault(parsed, appConfig.syncCronTab);
  if (!validateMonthLabel(parsed, logger)) process.exit(2);
  if (parsed.monthLabel) logger.info(`Month override: ${parsed.monthLabel}`);

  const members = await readMembers();
  if (members.length === 0) {
    logger.error("Members tab is empty — populate it before running sync.");
    process.exit(2);
  }

  const targetMembers = pickTargetMembers(parsed, members, logger);
  if (!targetMembers) process.exit(2);

  const ordered = [...targetMembers].sort((left, right) => targetSortOrder(left.role) - targetSortOrder(right.role));
  logger.info(`Targets (${ordered.length}): ${ordered.map((m) => `${m.tabName}[${m.role}]`).join(", ")}`);

  const createdOnOrAfter = earliestCreatedFetchFloor(parsed.monthLabel, new Date());
  logger.info(`Fetching pages from Notion DB ${appConfig.notionDatabaseId} on or after ${createdOnOrAfter.toISOString()}...`);
  const allPages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, { createdOnOrAfter });
  logger.info(`Fetched ${allPages.length} pages.`);

  const sheets = createSheetsClient(appConfig.googleServiceAccountKeyFile, appConfig.googleSheetsId);
  const monthLabel = parsed.monthLabel ?? currentMonthLabel(new Date());

  const failures: string[] = [];
  for (const member of ordered) {
    const role = member.role.trim().toLowerCase();
    const notionName = notionDisplayNameFor(member);
    try {
      if (role === TESTER_ROLE) {
        await syncTesterTab({
          testerTab: member.tabName,
          testerNotionName: notionName,
          testerRole: member.role,
          monthLabel,
          members,
          allPages,
          sheets,
          logger,
        });
        continue;
      }

      const pointSource = pointSourceForRole(member.role);
      if (pointSource === "story_point") logger.info(`[${member.tabName}] role "${member.role}" → using Story Points`);
      await syncTab({
        tabName: member.tabName,
        assigneeName: notionName,
        allPages,
        sheets,
        logger,
        targetMonthOverride: parsed.monthLabel,
        pointSource,
        role: member.role,
      });
    } catch (cause) {
      const message = `Tab "${member.tabName}" failed: ${(cause as Error).message}`;
      logger.error(message, cause);
      failures.push(message);
    }
  }

  if (failures.length > 0) {
    await logger.notifyFailure(failures.join("\n"));
    process.exit(1);
  }

  logger.info("All targets synced OK.");
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
