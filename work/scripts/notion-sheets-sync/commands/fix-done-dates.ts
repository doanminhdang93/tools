// Repair pass: force every task's Notion "Done date" to the month-end of the
// sheet section it sits in. Reads the Sheet, writes only Notion — no sheet cell
// is ever touched.
//
//   npx tsx commands/fix-done-dates.ts --months 6/2026,7/2026            # dry run
//   npx tsx commands/fix-done-dates.ts --months 6/2026,7/2026 --apply
//   npx tsx commands/fix-done-dates.ts --months 7/2026 --tab HieuNM --apply
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { COLUMN_INDEX } from "../src/constants.ts";
import { createSheetsClient } from "../src/sheets/client.ts";
import { parseTab } from "../src/sheets/parser.ts";
import { createNotionClient, fetchAllPages, type NotionPage } from "../src/notion/client.ts";
import { pushDoneDateToNotion } from "../src/notion/update.ts";
import { doneDateOf, titleOf } from "../src/notion/fields.ts";
import { extractPageIdFromUrl, normalizeNotionPageId } from "../src/notion/url.ts";
import { kpiCycleStart, lastDayOfMonth } from "../src/util/month.ts";
import { readMembers } from "../src/util/members.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

interface RepairTarget {
  pageId: string;
  tabName: string;
  monthLabel: string;
  title: string;
}

interface ParsedArguments {
  monthLabels: string[];
  tabName?: string;
  apply: boolean;
  backupPath: string;
}

function parseArguments(argv: string[]): ParsedArguments {
  const args = argv.slice(2);
  const parsed: ParsedArguments = {
    monthLabels: [],
    apply: false,
    backupPath: resolve(import.meta.dirname, "../done-date-backup.json"),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--months") { parsed.monthLabels = args[++i].split(",").map((label) => label.trim()); continue; }
    if (args[i] === "--tab") { parsed.tabName = args[++i]; continue; }
    if (args[i] === "--backup") { parsed.backupPath = resolve(args[++i]); continue; }
    if (args[i] === "--apply") { parsed.apply = true; continue; }
  }
  return parsed;
}

async function collectTargets(
  tabNames: string[],
  monthLabels: Set<string>,
  sheets: ReturnType<typeof createSheetsClient>,
): Promise<RepairTarget[]> {
  const targetByPageId = new Map<string, RepairTarget>();

  for (const tabName of tabNames) {
    let rows: string[][];
    try {
      rows = await sheets.readTabValues(tabName);
    } catch (cause) {
      console.warn(`[${tabName}] not readable, skipped: ${(cause as Error).message}`);
      continue;
    }

    const sections = parseTab(rows).sections.filter((section) => monthLabels.has(section.monthLabel));
    for (const section of sections) {
      for (const row of section.taskRows) {
        const pageId = extractPageIdFromUrl(row[COLUMN_INDEX.link] ?? "");
        if (!pageId) continue;

        const existing = targetByPageId.get(pageId);
        if (existing && existing.monthLabel !== section.monthLabel) {
          console.warn(
            `  ! ${pageId.slice(0, 8)} sits in ${existing.monthLabel} on ${existing.tabName} but ${section.monthLabel} on ${tabName} — keeping ${existing.monthLabel}`,
          );
          continue;
        }
        if (existing) continue;

        targetByPageId.set(pageId, {
          pageId,
          tabName,
          monthLabel: section.monthLabel,
          title: (row[COLUMN_INDEX.title] ?? "").toString(),
        });
      }
      console.log(`[${tabName}] ${section.monthLabel}: ${section.taskRows.length} row(s)`);
    }
  }

  return [...targetByPageId.values()];
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv);
  if (parsed.monthLabels.length === 0) {
    console.error("Usage: tsx commands/fix-done-dates.ts --months 6/2026,7/2026 [--tab <Name>] [--apply]");
    process.exit(2);
  }

  const appConfig = loadConfig();
  const sheets = createSheetsClient(appConfig.googleServiceAccountKeyFile, appConfig.googleSheetsId);
  const notionClient = createNotionClient(appConfig.notionApiKey);

  const members = await readMembers();
  const tabNames = parsed.tabName
    ? [parsed.tabName]
    : members.map((member) => member.tabName);
  console.log(`Months: ${parsed.monthLabels.join(", ")} — tabs: ${tabNames.join(", ")}\n`);

  const targets = await collectTargets(tabNames, new Set(parsed.monthLabels), sheets);
  console.log(`\n${targets.length} distinct task(s) to map.`);

  const earliestCycleStart = parsed.monthLabels
    .map((monthLabel) => kpiCycleStart(monthLabel))
    .reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
  const pages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, {
    createdOnOrAfter: earliestCycleStart,
  });
  const pageById = new Map(pages.map((page) => [normalizeNotionPageId(page.id), page]));

  // Tasks created before the query window still sit in these sections; fetch
  // them one by one so their current Done date is known instead of assumed.
  for (const target of targets) {
    if (pageById.has(target.pageId)) continue;
    try {
      const page = await notionClient.pages.retrieve({ page_id: target.pageId });
      if (!("properties" in page)) continue;
      pageById.set(target.pageId, { id: page.id, properties: page.properties as NotionPage["properties"] });
    } catch (cause) {
      console.warn(`  ! ${target.pageId.slice(0, 8)} not retrievable: ${(cause as Error).message}`);
    }
  }

  const changes: { pageId: string; tabName: string; title: string; from: string; to: string }[] = [];
  let unchanged = 0;
  for (const target of targets) {
    const page = pageById.get(target.pageId);
    const currentDoneDate = page ? doneDateOf(page) : "(page not fetched)";
    const wantedDoneDate = lastDayOfMonth(target.monthLabel);
    if (currentDoneDate === wantedDoneDate) {
      unchanged++;
      continue;
    }
    changes.push({
      pageId: target.pageId,
      tabName: target.tabName,
      title: page ? titleOf(page) : target.title,
      from: currentDoneDate,
      to: wantedDoneDate,
    });
  }

  console.log(`Already correct: ${unchanged} — to change: ${changes.length}`);
  for (const change of changes.slice(0, 15)) {
    console.log(`  ${change.tabName.padEnd(9)} ${change.pageId.slice(0, 8)} ${(change.from || "(empty)").padEnd(30)} → ${change.to}`);
  }
  if (changes.length > 15) console.log(`  … and ${changes.length - 15} more`);

  if (!parsed.apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to write these Done dates.");
    return;
  }

  writeFileSync(parsed.backupPath, JSON.stringify(changes, null, 2));
  console.log(`\nBackup of previous values → ${parsed.backupPath}`);

  let written = 0;
  const failures: string[] = [];
  for (const change of changes) {
    const page = pageById.get(change.pageId) ?? { id: change.pageId, properties: {} };
    const result = await pushDoneDateToNotion({ client: notionClient, page, doneDate: change.to });
    if (!result.ok) {
      failures.push(`${change.pageId.slice(0, 8)}: ${result.reason}`);
      continue;
    }
    written++;
    if (written % 25 === 0) console.log(`  … ${written}/${changes.length}`);
  }

  console.log(`\nDone date written: ${written}/${changes.length}`);
  if (failures.length > 0) {
    console.log(`Failures (${failures.length}):`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
  }
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
