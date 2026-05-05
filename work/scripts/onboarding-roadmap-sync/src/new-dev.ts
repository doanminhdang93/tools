#!/usr/bin/env tsx
import { Command } from "commander";
import { input } from "@inquirer/prompts";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import {
  findInlineDatabase,
  makeClient,
  renamePage,
  resetAllTaskStatuses,
} from "./notion-client.ts";
import { log } from "./logger.ts";
import { DEFAULT_STATUS_FOR_NEW_TASK } from "../config.ts";

loadEnv({ path: resolve(process.cwd(), "../../../.token.env") });

type Options = { page?: string; name?: string };

function parsePageId(pageInput: string): string {
  const cleaned = pageInput.replace(/-/g, "");
  const match = cleaned.match(/[0-9a-f]{32}/i);
  if (!match) throw new Error(`Could not parse page id from: ${pageInput}`);
  const id = match[0];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function main(options: Options): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY missing from .token.env");

  const pageInput = options.page ?? (await input({ message: "URL of the duplicated Notion page?" }));
  const name = options.name ?? (await input({ message: "Developer's full name?" }));
  if (!name.trim()) throw new Error("Developer name is required");
  const pageId = parsePageId(pageInput);

  const client = makeClient(token);
  const dbId = await findInlineDatabase(client, pageId);
  if (!dbId) throw new Error("No inline database found inside the duplicated page.");

  const newTitle = `[Dev] Onboarding - ${name.trim()}`;
  log.info(`Renaming page → "${newTitle}"`);
  await renamePage(client, pageId, newTitle);

  log.info(`Resetting Status of every task to ${DEFAULT_STATUS_FOR_NEW_TASK}...`);
  const count = await resetAllTaskStatuses(client, dbId);
  log.ok(`Done. Renamed page + reset ${count} tasks.`);
}

const program = new Command();
program
  .option("--page <url>", "URL of the duplicated Notion page")
  .option("--name <name>", "developer's full name")
  .action((opts: Options) =>
    main(opts).catch((err) => {
      log.error(String(err));
      process.exit(1);
    }),
  );

program.parse();
