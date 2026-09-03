// Export every task sitting on the Sheet into the "counted tasks" CSV
// (taskId,thang,team,ghiChu). One row per distinct Notion task; the month comes
// from the sheet section the task sits in.
//
//   npx tsx commands/export-counted-tasks.ts --from 3/2026 --out ~/Downloads/counted-tasks.csv
//   npx tsx commands/export-counted-tasks.ts --from 3/2026 --team x-team --out <path>
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadConfig } from "../src/config.ts";
import { COLUMN_INDEX } from "../src/constants.ts";
import { createSheetsClient } from "../src/sheets/client.ts";
import { parseTab } from "../src/sheets/parser.ts";
import { createNotionClient, fetchAllPages, type NotionPage } from "../src/notion/client.ts";
import { extractPageIdFromUrl, normalizeNotionPageId } from "../src/notion/url.ts";
import { kpiCycleStart, monthLabelToDate } from "../src/util/month.ts";
import { readMembers } from "../src/util/members.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const CSV_HEADER = "taskId,thang,team,ghiChu";

interface ExportRow {
  pageId: string;
  monthLabel: string;
  tabName: string;
}

interface ParsedArguments {
  fromMonthLabel: string;
  teamName: string;
  outputPath: string;
}

function parseArguments(argv: string[]): ParsedArguments {
  const args = argv.slice(2);
  const parsed: ParsedArguments = { fromMonthLabel: "", teamName: "x-team", outputPath: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from") { parsed.fromMonthLabel = args[++i]; continue; }
    if (args[i] === "--team") { parsed.teamName = args[++i]; continue; }
    if (args[i] === "--out") { parsed.outputPath = expandHome(args[++i]); continue; }
  }
  return parsed;
}

function expandHome(path: string): string {
  return path.startsWith("~") ? resolve(homedir(), path.slice(2)) : resolve(path);
}

// "7/2026" → "2026-07"
function toCsvMonth(monthLabel: string): string {
  const [month, year] = monthLabel.split("/");
  return `${year}-${month.padStart(2, "0")}`;
}

function taskIdOf(page: NotionPage): string {
  const property = page.properties["Task ID"];
  if (!property || property.type !== "unique_id") return "";
  const uniqueId = (property as { unique_id?: { prefix?: string | null; number?: number | null } }).unique_id;
  if (typeof uniqueId?.number !== "number") return "";
  return uniqueId.prefix ? `${uniqueId.prefix}-${uniqueId.number}` : String(uniqueId.number);
}

function toCsvField(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

async function collectRows(fromMonthLabel: string): Promise<ExportRow[]> {
  const appConfig = loadConfig();
  const sheets = createSheetsClient(appConfig.googleServiceAccountKeyFile, appConfig.googleSheetsId);
  const fromDate = monthLabelToDate(fromMonthLabel);

  const rowByPageId = new Map<string, ExportRow>();
  for (const member of await readMembers()) {
    let sheetRows: string[][];
    try {
      sheetRows = await sheets.readTabValues(member.tabName);
    } catch (cause) {
      console.warn(`[${member.tabName}] unreadable, skipped: ${(cause as Error).message}`);
      continue;
    }

    const sections = parseTab(sheetRows).sections.filter(
      (section) => monthLabelToDate(section.monthLabel) >= fromDate,
    );
    for (const section of sections) {
      for (const row of section.taskRows) {
        const pageId = extractPageIdFromUrl(row[COLUMN_INDEX.link] ?? "");
        if (!pageId) continue;

        const existing = rowByPageId.get(pageId);
        if (existing && existing.monthLabel !== section.monthLabel) {
          console.warn(
            `  ! ${pageId.slice(0, 8)} is in ${existing.monthLabel} on ${existing.tabName} but ${section.monthLabel} on ${member.tabName} — keeping ${existing.monthLabel}`,
          );
          continue;
        }
        if (existing) continue;

        rowByPageId.set(pageId, { pageId, monthLabel: section.monthLabel, tabName: member.tabName });
      }
    }
  }
  return [...rowByPageId.values()];
}

async function buildTaskIdIndex(rows: ExportRow[], fromMonthLabel: string): Promise<Map<string, string>> {
  const appConfig = loadConfig();
  const notionClient = createNotionClient(appConfig.notionApiKey);
  const pages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, {
    createdOnOrAfter: kpiCycleStart(fromMonthLabel),
  });
  const taskIdByPageId = new Map<string, string>();
  for (const page of pages) taskIdByPageId.set(normalizeNotionPageId(page.id), taskIdOf(page));

  // Tasks created before the query window still sit in these sections.
  for (const row of rows) {
    if (taskIdByPageId.has(row.pageId)) continue;
    try {
      const page = await notionClient.pages.retrieve({ page_id: row.pageId });
      if (!("properties" in page)) continue;
      taskIdByPageId.set(
        row.pageId,
        taskIdOf({ id: page.id, properties: page.properties as NotionPage["properties"] }),
      );
    } catch (cause) {
      console.warn(`  ! ${row.pageId.slice(0, 8)} not retrievable: ${(cause as Error).message}`);
    }
  }
  return taskIdByPageId;
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv);
  if (!parsed.fromMonthLabel || !parsed.outputPath) {
    console.error("Usage: tsx commands/export-counted-tasks.ts --from M/YYYY --out <path> [--team x-team]");
    process.exit(2);
  }

  const rows = await collectRows(parsed.fromMonthLabel);
  console.log(`\n${rows.length} distinct task(s) from ${parsed.fromMonthLabel} onwards`);

  const taskIdByPageId = await buildTaskIdIndex(rows, parsed.fromMonthLabel);

  const csvLines = [CSV_HEADER];
  const missingTaskId: ExportRow[] = [];
  for (const row of rows.sort(sortByMonthThenTaskId(taskIdByPageId))) {
    const taskId = taskIdByPageId.get(row.pageId) ?? "";
    if (!taskId) {
      missingTaskId.push(row);
      continue;
    }
    const monthNumber = row.monthLabel.split("/")[0];
    csvLines.push([
      toCsvField(taskId),
      toCsvField(toCsvMonth(row.monthLabel)),
      toCsvField(parsed.teamName),
      toCsvField(`Đã tính ở Excel tháng ${monthNumber}`),
    ].join(","));
  }

  writeFileSync(parsed.outputPath, `${csvLines.join("\n")}\n`);
  console.log(`\nWrote ${csvLines.length - 1} row(s) → ${parsed.outputPath}`);
  if (missingTaskId.length > 0) {
    console.log(`Skipped ${missingTaskId.length} task(s) with no Notion Task ID:`);
    for (const row of missingTaskId) console.log(`  ✗ ${row.tabName} ${row.monthLabel} ${row.pageId.slice(0, 8)}`);
  }
}

function sortByMonthThenTaskId(taskIdByPageId: Map<string, string>) {
  return (left: ExportRow, right: ExportRow): number => {
    const monthDifference = monthLabelToDate(left.monthLabel).getTime() - monthLabelToDate(right.monthLabel).getTime();
    if (monthDifference !== 0) return monthDifference;
    const leftTaskId = Number(taskIdByPageId.get(left.pageId) ?? 0);
    const rightTaskId = Number(taskIdByPageId.get(right.pageId) ?? 0);
    return leftTaskId - rightTaskId;
  };
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
