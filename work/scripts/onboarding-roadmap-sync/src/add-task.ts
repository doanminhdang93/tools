#!/usr/bin/env tsx
import { Command } from "commander";
import { select, input } from "@inquirer/prompts";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { DOCS_BASE_URL } from "../config.ts";
import {
  ensureDbProperties,
  indexExistingTasks,
  createTask,
  replaceTaskBody,
  makeClient,
} from "./notion-client.ts";
import { extractMainHtml, extractTitle, fetchPage } from "./docs-fetcher.ts";
import { htmlToBlocks, type Block } from "./html-to-blocks.ts";
import { hashContent, normaliseText } from "./matching.ts";
import { log } from "./logger.ts";
import {
  buildAugmentationBlocks,
  buildHeaderCallout,
  getAugmentation,
} from "./task-augmenter.ts";

loadEnv({ path: resolve(process.cwd(), "../../../.token.env") });

type Options = { url?: string; week?: number };

async function main(options: Options): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY missing from .token.env");

  const url = options.url ?? (await input({ message: "Docs URL?" }));
  if (!url.startsWith(DOCS_BASE_URL)) {
    throw new Error(`URL must start with ${DOCS_BASE_URL}`);
  }
  const week =
    options.week ??
    (await select({
      message: "Which week?",
      choices: [1, 2, 3, 4].map((n) => ({ name: `Week ${n}`, value: n })),
    }));

  const client = makeClient(token);
  await ensureDbProperties(client);
  const existing = await indexExistingTasks(client);

  log.info(`Fetching ${url}`);
  const pageHtml = await fetchPage(url);
  const mainHtml = extractMainHtml(pageHtml);
  const title = extractTitle(pageHtml);
  const mainText = normaliseText(title + " " + mainHtml.replace(/<[^>]+>/g, " "));
  const docBlocks = htmlToBlocks(mainHtml, DOCS_BASE_URL);

  const augmentation = getAugmentation(url);
  const headerBlock: Block = buildHeaderCallout({ title, url, objective: augmentation.objective });
  const dividerAfterHeader: Block = { type: "divider", divider: {} };
  const augBlocks = buildAugmentationBlocks(augmentation);
  const blocks: Block[] = [headerBlock, dividerAfterHeader, ...docBlocks, ...augBlocks];

  const newHash = hashContent(mainText + " " + JSON.stringify(augmentation));

  const found = existing.get(url);
  if (!found) {
    await createTask(client, { title, week, sourceUrl: url, sourceHash: newHash, blocks });
    log.ok(`Created task "${title}" (Week ${week})`);
  } else {
    await replaceTaskBody(client, found.pageId, blocks, newHash);
    log.ok(`Updated body of "${title}"`);
  }
}

const program = new Command();
program
  .option("--url <url>", "docs URL of the task")
  .option("--week <n>", "week 1-4", (v) => Number(v))
  .action((opts: Options) =>
    main(opts).catch((err) => {
      log.error(String(err));
      process.exit(1);
    }),
  );

program.parse();
