import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { Client as NotionClient } from "@notionhq/client";
import { loadConfig } from "./config.ts";
import { fetchAllPages } from "./notion/client.ts";
import { createSheetsClient } from "./sheets/client.ts";
import { createLogger, type Logger } from "./logger.ts";
import { syncTab, type SyncTabResult } from "./sync.ts";
import { syncTesterTab, type SyncTesterResult } from "./sync-tester.ts";
import { currentMonthLabel, kpiWindowStart } from "./util/month.ts";
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
  monthLabel?: string;
  role?: string;
}

function parseCliArguments(argv: string[]): ParsedArguments {
  const args = argv.slice(2);
  const parsed: ParsedArguments = { syncAll: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") { parsed.syncAll = true; continue; }
    if (arg === "--tab") { parsed.tabName = args[++i]; continue; }
    if (arg === "--month") { parsed.monthLabel = args[++i]; continue; }
    if (arg === "--role") { parsed.role = args[++i]; continue; }
    if (arg.startsWith("--")) continue;
    if (!parsed.tabName) parsed.tabName = arg;
  }

  return parsed;
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


async function main(): Promise<void> {
  const appConfig = loadConfig();
  const logger = createLogger({
    slackBotToken: appConfig.slackBotToken,
    notifyChannel: appConfig.notifyOnErrorChannel,
  });

  const parsed = parseCliArguments(process.argv);
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

  const targetLabelForWindow = parsed.monthLabel ?? currentMonthLabel(new Date());
  const createdOnOrAfter = kpiWindowStart(targetLabelForWindow);
  logger.info(`Fetching pages from Notion DB ${appConfig.notionDatabaseId} on or after ${createdOnOrAfter.toISOString()}...`);
  const allPages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, { createdOnOrAfter });
  logger.info(`Fetched ${allPages.length} pages.`);

  const sheets = createSheetsClient(appConfig.googleServiceAccountKeyFile, appConfig.googleSheetsId);
  const notionClient = new NotionClient({ auth: appConfig.notionApiKey });
  const monthLabel = parsed.monthLabel ?? currentMonthLabel(new Date());

  interface SyncedSummary {
    tabName: string;
    role: string;
    taskCount: number;
    totalPoints: number;
  }

  const failures: string[] = [];
  const successes: SyncedSummary[] = [];
  const SLEEP_BETWEEN_TABS_MS = 15000;

  for (let memberIndex = 0; memberIndex < ordered.length; memberIndex++) {
    const member = ordered[memberIndex];
    const role = member.role.trim().toLowerCase();
    const notionName = notionDisplayNameFor(member);
    try {
      let result: SyncTabResult | SyncTesterResult;
      if (role === TESTER_ROLE) {
        result = await syncTesterTab({
          testerTab: member.tabName,
          testerNotionName: notionName,
          testerRole: member.role,
          monthLabel,
          members,
          allPages,
          sheets,
          logger,
        });
      } else {
        const pointSource = pointSourceForRole(member.role);
        if (pointSource === "story_point") logger.info(`[${member.tabName}] role "${member.role}" → using Story Points`);
        result = await syncTab({
          tabName: member.tabName,
          assigneeName: notionName,
          allPages,
          sheets,
          logger,
          targetMonthOverride: parsed.monthLabel,
          pointSource,
          role: member.role,
          notionClient,
        });
      }
      successes.push({
        tabName: member.tabName,
        role: member.role,
        taskCount: result.taskCount,
        totalPoints: result.totalPoints,
      });
    } catch (cause) {
      const message = `Tab "${member.tabName}" failed: ${(cause as Error).message}`;
      logger.error(message, cause);
      failures.push(message);
    }

    if (memberIndex < ordered.length - 1) {
      logger.info(`Sleeping ${SLEEP_BETWEEN_TABS_MS / 1000}s before next tab to respect Sheets API rate limit`);
      await new Promise((resolveAfter) => setTimeout(resolveAfter, SLEEP_BETWEEN_TABS_MS));
    }
  }

  const successSummary = buildSyncSummary(monthLabel, successes, failures);
  logger.info(successSummary);

  if (failures.length > 0) {
    await logger.notifyFailure(successSummary);
    process.exit(1);
  }

  await logger.notifySuccess(successSummary);
  logger.info("All targets synced OK.");
}

function buildSyncSummary(
  monthLabel: string,
  successes: { tabName: string; role: string; taskCount: number; totalPoints: number }[],
  failures: string[],
): string {
  const lines: string[] = [];
  lines.push(`Month: ${monthLabel}`);
  lines.push(`Synced: ${successes.length}, Failed: ${failures.length}`);
  lines.push("");

  const totalTasks = successes.reduce((sum, member) => sum + member.taskCount, 0);
  const totalPoints = successes.reduce((sum, member) => sum + member.totalPoints, 0);
  for (const member of successes) {
    lines.push(`• ${member.tabName} [${member.role}] — ${member.taskCount} tasks, ${member.totalPoints} pts`);
  }
  lines.push("");
  lines.push(`Total: ${totalTasks} tasks, ${totalPoints} pts`);

  if (failures.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const failure of failures) lines.push(`✗ ${failure}`);
  }
  return lines.join("\n");
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
