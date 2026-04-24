import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { fetchAllPages } from "./notion/client.ts";
import { createSheetsClient } from "./sheets/client.ts";
import { createLogger, type Logger } from "./logger.ts";
import { syncTab } from "./sync.ts";
import { resolveTargetTabs, type TabEntry } from "./resolve-tabs.ts";
import {
  currentMonthLabel,
  firstInstantOfMonth,
  previousMonthLabel,
} from "./util/month.ts";
import { assignees, overrides } from "../tabs.config.ts";

const ROOT_TOKEN_ENV_PATH = resolve(import.meta.dirname, "../../../../.token.env");
loadDotenv({ path: ROOT_TOKEN_ENV_PATH });

const MONTH_LABEL_PATTERN = /^\d{1,2}\/\d{4}$/;

interface ParsedArguments {
  tabName?: string;
  syncAll: boolean;
  cronMode: boolean;
  monthLabel?: string;
}

function parseCliArguments(argv: string[]): ParsedArguments {
  const userArguments = argv.slice(2);
  const parsed: ParsedArguments = { syncAll: false, cronMode: false };

  for (let index = 0; index < userArguments.length; index++) {
    const currentArgument = userArguments[index];

    if (currentArgument === "--all") {
      parsed.syncAll = true;
      continue;
    }

    if (currentArgument === "--cron") {
      parsed.cronMode = true;
      continue;
    }

    if (currentArgument === "--tab") {
      parsed.tabName = userArguments[++index];
      continue;
    }

    if (currentArgument === "--month") {
      parsed.monthLabel = userArguments[++index];
      continue;
    }

    if (currentArgument.startsWith("--")) continue;
    if (!parsed.tabName) parsed.tabName = currentArgument;
  }

  return parsed;
}

// `--cron` resolves SYNC_CRON_TAB: "all" (any case) → sync all tabs;
// a specific member name → sync only that tab; unset → sync all (central runner install).
function applyCronDefault(parsed: ParsedArguments, syncCronTab: string | undefined): void {
  if (!parsed.cronMode) return;
  if (parsed.syncAll || parsed.tabName) return;

  const trimmed = syncCronTab?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") {
    parsed.syncAll = true;
    return;
  }
  parsed.tabName = trimmed;
}

function pickTabsForRun(
  parsed: ParsedArguments,
  allPossibleTabs: TabEntry[],
  logger: Logger,
): TabEntry[] | null {
  if (parsed.syncAll) return allPossibleTabs;

  if (!parsed.tabName) {
    logger.error(
      "Usage: npm run sync -- <tab-name> [--month M/YYYY] | --tab <name> [--month M/YYYY] | --all [--month M/YYYY]",
    );
    return null;
  }

  const match = allPossibleTabs.find((entry) => entry.tabName === parsed.tabName);
  if (match) return [match];

  const availableTabs = allPossibleTabs.map((entry) => entry.tabName).join(", ");
  logger.error(`Tab "${parsed.tabName}" not resolvable. Available: ${availableTabs}`);
  return null;
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

// Earliest possible candidate-window start across every tab this run might sync.
// - --month M/YYYY: target is fixed → window starts at 1/previousMonth(M/YYYY).
// - default: target resolves to either currentMonth (window = 1/previous) or
//   previousMonth (window = 1/monthBeforePrevious); take the wider of the two.
function earliestCreatedFetchFloor(monthOverride: string | undefined, now: Date): Date {
  if (monthOverride) {
    return firstInstantOfMonth(previousMonthLabel(monthOverride));
  }
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

  if (parsed.monthLabel) {
    logger.info(`Using explicit month override: ${parsed.monthLabel}`);
  }

  const createdOnOrAfter = earliestCreatedFetchFloor(parsed.monthLabel, new Date());
  logger.info(
    `Fetching pages from Notion DB ${appConfig.notionDatabaseId} created on or after ${createdOnOrAfter.toISOString()}...`,
  );
  const allPages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, {
    createdOnOrAfter,
  });
  logger.info(`Fetched ${allPages.length} pages.`);

  const sheets = createSheetsClient(
    appConfig.googleServiceAccountKeyFile,
    appConfig.googleSheetsId,
  );

  const allPossibleTabs = await resolveTargetTabs({
    explicitAssignees: assignees,
    overrides,
    allPages,
    sheets,
  });

  if (allPossibleTabs.length === 0) {
    logger.error(
      "No tabs resolved. Either set tabs.config.ts `assignees`, or ensure the sheet has tabs whose names match `deriveTabName(<Notion person>)`.",
    );
    process.exit(2);
  }

  const mode = assignees.length > 0 ? "explicit" : "auto-discovered";
  logger.info(
    `Resolved ${allPossibleTabs.length} tab(s) [${mode}]: ${allPossibleTabs.map((t) => t.tabName).join(", ")}`,
  );

  const targetTabs = pickTabsForRun(parsed, allPossibleTabs, logger);
  if (!targetTabs) process.exit(2);

  const failures: string[] = [];
  for (const target of targetTabs) {
    try {
      await syncTab({
        tabName: target.tabName,
        assigneeName: target.notionAssigneeName,
        allPages,
        sheets,
        logger,
        targetMonthOverride: parsed.monthLabel,
      });
    } catch (cause) {
      const failureMessage = `Tab "${target.tabName}" failed: ${(cause as Error).message}`;
      logger.error(failureMessage, cause);
      failures.push(failureMessage);
    }
  }

  if (failures.length > 0) {
    await logger.notifyFailure(failures.join("\n"));
    process.exit(1);
  }

  logger.info("All tabs synced OK.");
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
