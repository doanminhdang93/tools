#!/usr/bin/env tsx
import { Command } from "commander";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { DOCS_BASE_URL, NOTION_PAGE_ID, SIDEBAR_SEED_URL, WEEK_SECTIONS } from "../config.ts";
import {
  ensureDbProperties,
  indexExistingTasks,
  createTask,
  replaceTaskBody,
  replacePageIntro,
  makeClient,
  type ExistingTask,
} from "./notion-client.ts";
import { extractMainHtml, extractTitle, fetchPage, parseSidebar } from "./docs-fetcher.ts";
import { htmlToBlocks, type Block } from "./html-to-blocks.ts";
import { hashContent, normaliseText } from "./matching.ts";
import { log, makeCounters } from "./logger.ts";
import {
  buildAugmentationBlocks,
  buildHeaderCallout,
  buildMasterIntroBlocks,
  getAugmentation,
} from "./task-augmenter.ts";

loadEnv({ path: resolve(process.cwd(), "../../../.token.env") });

type Options = { dryRun: boolean; force: boolean; week?: number; skipIntro: boolean };

async function main(options: Options): Promise<void> {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY missing from .token.env");
  const client = makeClient(token);

  log.info("Ensuring DB schema has Source URL + Source Hash...");
  if (!options.dryRun) await ensureDbProperties(client);

  if (!options.skipIntro) {
    log.info("Updating master page intro...");
    if (!options.dryRun) {
      await replacePageIntro(client, NOTION_PAGE_ID, buildMasterIntroBlocks());
    }
  }

  log.info(`Fetching sidebar from ${SIDEBAR_SEED_URL}`);
  const sidebarHtml = await fetchPage(SIDEBAR_SEED_URL);
  let items = parseSidebar(sidebarHtml, WEEK_SECTIONS, DOCS_BASE_URL);
  if (options.week) items = items.filter((i) => i.week === options.week);
  log.info(`Found ${items.length} docs items in scope`);

  log.info("Indexing existing tasks in DB...");
  const existing: Map<string, ExistingTask> = options.dryRun
    ? new Map()
    : await indexExistingTasks(client);
  const seenUrls = new Set<string>();
  const counters = makeCounters();

  for (const item of items) {
    seenUrls.add(item.url);
    log.info(`→ ${item.title} (Week ${item.week})`);
    const pageHtml = await fetchPage(item.url);
    const mainHtml = extractMainHtml(pageHtml);
    const title = extractTitle(pageHtml) || item.title;
    const mainText = normaliseText(title + " " + mainHtml.replace(/<[^>]+>/g, " "));
    const docBlocks = htmlToBlocks(mainHtml, DOCS_BASE_URL);

    const augmentation = getAugmentation(item.url);
    const headerBlock: Block = buildHeaderCallout({ title, url: item.url, objective: augmentation.objective });
    const dividerAfterHeader: Block = { type: "divider", divider: {} };
    const augBlocks = buildAugmentationBlocks(augmentation);
    const blocks: Block[] = [headerBlock, dividerAfterHeader, ...docBlocks, ...augBlocks];

    const augmentedText = mainText + " " + JSON.stringify(augmentation);
    const newHash = hashContent(augmentedText);

    const found = existing.get(item.url);
    const needsWrite = !found || options.force || found.sourceHash !== newHash;

    if (!needsWrite) {
      log.info(`skip (no change): ${item.title}`);
      counters.skipped += 1;
      continue;
    }

    if (!found) {
      log.ok(`would create: ${item.title}`);
      if (!options.dryRun) {
        await createTask(client, {
          title,
          week: item.week,
          sourceUrl: item.url,
          sourceHash: newHash,
          blocks,
        });
      }
      counters.created += 1;
    } else {
      log.ok(`would update: ${item.title}`);
      if (!options.dryRun) await replaceTaskBody(client, found.pageId, blocks, newHash);
      counters.updated += 1;
    }
  }

  for (const [url] of existing) {
    if (!seenUrls.has(url)) {
      log.warn(`orphan task with Source URL ${url} — present in Notion but not in sidebar`);
      counters.orphans += 1;
    }
  }

  log.summary(counters);
}

const program = new Command();
program
  .option("--dry-run", "log intent without writing to Notion", false)
  .option("--force", "rewrite body for every matched task even if hash is unchanged", false)
  .option("--week <n>", "limit to a single week (1-4)", (v) => Number(v))
  .option("--skip-intro", "do not update the master page intro", false)
  .action((opts: Options) =>
    main(opts).catch((err) => {
      log.error(String(err));
      process.exit(1);
    }),
  );

program.parse();
