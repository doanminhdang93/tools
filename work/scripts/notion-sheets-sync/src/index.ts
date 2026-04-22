import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { fetchAllPages } from "./notion/client.ts";
import { createSheetsClient } from "./sheets/client.ts";
import { createLogger, type Logger } from "./logger.ts";
import { syncTab } from "./sync.ts";
import { resolveTabs, type TabEntry } from "../tabs.config.ts";

const ROOT_TOKEN_ENV_PATH = resolve(import.meta.dirname, "../../../../.token.env");
loadDotenv({ path: ROOT_TOKEN_ENV_PATH });

interface ParsedArguments {
  tabName?: string;
  syncAll: boolean;
}

function parseCliArguments(argv: string[]): ParsedArguments {
  const userArguments = argv.slice(2);

  if (userArguments.includes("--all")) return { syncAll: true };

  const flagIndex = userArguments.indexOf("--tab");
  if (flagIndex >= 0 && userArguments[flagIndex + 1]) {
    return { syncAll: false, tabName: userArguments[flagIndex + 1] };
  }

  const positional = userArguments.find((value) => !value.startsWith("--"));
  if (positional) return { syncAll: false, tabName: positional };

  return { syncAll: false };
}

function resolveTargetTabs(
  parsed: ParsedArguments,
  configuredTabs: TabEntry[],
  logger: Logger,
): TabEntry[] | null {
  if (parsed.syncAll) return configuredTabs;

  if (!parsed.tabName) {
    logger.error("Usage: npm run sync -- <tab-name> | --tab <name> | --all");
    return null;
  }

  const match = configuredTabs.find((entry) => entry.tabName === parsed.tabName);
  if (match) return [match];

  const availableTabs = configuredTabs.map((entry) => entry.tabName).join(", ");
  logger.error(`Tab "${parsed.tabName}" not in tabs.config.ts. Available: ${availableTabs}`);
  return null;
}

async function main(): Promise<void> {
  const appConfig = loadConfig();
  const logger = createLogger({
    slackBotToken: appConfig.slackBotToken,
    notifyChannel: appConfig.notifyOnErrorChannel,
  });

  const parsed = parseCliArguments(process.argv);
  const configuredTabs = resolveTabs();

  const targetTabs = resolveTargetTabs(parsed, configuredTabs, logger);
  if (!targetTabs) {
    process.exit(2);
  }

  logger.info(`Fetching all pages from Notion DB ${appConfig.notionDatabaseId}...`);
  const allPages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId);
  logger.info(`Fetched ${allPages.length} total pages.`);

  const sheets = createSheetsClient(
    appConfig.googleServiceAccountKeyFile,
    appConfig.googleSheetsId,
  );

  const failures: string[] = [];
  for (const target of targetTabs) {
    try {
      await syncTab({
        tabName: target.tabName,
        assigneeName: target.notionAssigneeName,
        allPages,
        sheets,
        logger,
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
