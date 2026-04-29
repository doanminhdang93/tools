import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { Client as NotionClient } from "@notionhq/client";
import { loadConfig } from "../src/config.ts";
import {
  COLUMN_INDEX,
  MONTH_HEADER_PATTERN,
  SHEET_COLUMN_COUNT,
  SHEET_COLUMN_HEADERS,
  columnLetter,
  moneyFormulaForRole,
  toSheetApp,
  toSheetStatus,
} from "../src/constants.ts";
import { extractPageIdFromUrl } from "../src/notion/url.ts";
import { formatSection } from "../src/format-section.ts";
import {
  titleOf,
  statusOf,
  tagNamesOf,
  pointNumberOf,
  assigneeNamesOf,
  followerNamesOf,
  type PointSource,
} from "../src/notion/fields.ts";
import { readMembers } from "../src/util/members.ts";
import type { NotionPage } from "../src/notion/client.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

interface CliArgs {
  tab: string;
  monthLabel: string;
  refSheet: string;
  refGid: string;
  refMonth: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const parsed: Partial<CliArgs> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--tab") { parsed.tab = args[++i]; continue; }
    if (arg === "--month") { parsed.monthLabel = args[++i]; continue; }
    if (arg === "--ref-sheet") { parsed.refSheet = args[++i]; continue; }
    if (arg === "--ref-gid") { parsed.refGid = args[++i]; continue; }
    if (arg === "--ref-month") { parsed.refMonth = Number(args[++i]); continue; }
  }
  if (!parsed.tab || !parsed.monthLabel || !parsed.refSheet || !parsed.refGid || !parsed.refMonth) {
    console.error("Usage: tsx commands/import-from-reference.ts --tab <Tab> --month <M/YYYY> --ref-sheet <ID> --ref-gid <GID> --ref-month <N>");
    process.exit(1);
  }
  return parsed as CliArgs;
}

interface ReferenceTask {
  pageId: string;
  pointFromRef: number;
}

async function fetchReferenceMonthTasks(
  refSheetId: string,
  refGid: string,
  refMonth: number,
): Promise<ReferenceTask[]> {
  const url = `https://docs.google.com/spreadsheets/d/${refSheetId}/export?format=csv&gid=${refGid}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Reference sheet fetch failed: HTTP ${response.status}`);
  const csv = await response.text();

  const lines = csv.split("\n");
  const sectionMarker = new RegExp(`^Th[áa]ng\\s*${refMonth}\\s*[/-]`, "i");

  let inSection = false;
  let foundHeader = false;
  const tasks: ReferenceTask[] = [];

  for (const line of lines) {
    if (sectionMarker.test(line)) {
      inSection = true;
      foundHeader = false;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("Tháng") || line.startsWith("Thang")) break;
    if (line.startsWith("STT,")) { foundHeader = true; continue; }
    if (!foundHeader) continue;

    const cells = parseCsvLine(line);
    const stt = (cells[0] ?? "").trim();
    if (!stt || Number.isNaN(Number(stt))) continue;

    const linkCell = (cells[4] ?? "").trim();
    const pointCell = (cells[7] ?? "").trim();
    const pageId = extractPageIdFromUrl(linkCell);
    if (!pageId) continue;
    const pointFromRef = Number(pointCell.replace(/,/g, "")) || 0;
    tasks.push({ pageId, pointFromRef });
  }
  return tasks;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let insideQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      insideQuotes = !insideQuotes;
      continue;
    }
    if (character === "," && !insideQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

function buildSheetsApi(serviceAccountKeyFile: string): sheets_v4.Sheets {
  const credentials = JSON.parse(readFileSync(resolve(serviceAccountKeyFile), "utf8"));
  const googleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth: googleAuth });
}

async function fetchNotionPagesByIds(
  notionApiKey: string,
  pageIds: string[],
): Promise<Map<string, NotionPage>> {
  const notion = new NotionClient({ auth: notionApiKey });
  const result = new Map<string, NotionPage>();
  for (const pageId of pageIds) {
    try {
      const uuid = `${pageId.slice(0, 8)}-${pageId.slice(8, 12)}-${pageId.slice(12, 16)}-${pageId.slice(16, 20)}-${pageId.slice(20)}`;
      const response = await notion.pages.retrieve({ page_id: uuid });
      if (!("properties" in response)) continue;
      result.set(pageId, {
        id: response.id,
        last_edited_time: (response as { last_edited_time?: string }).last_edited_time ?? "",
        properties: response.properties as NotionPage["properties"],
      });
    } catch (cause) {
      console.warn(`  ✗ failed to fetch ${pageId}: ${(cause as Error).message}`);
    }
  }
  return result;
}

async function deleteSectionRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  monthLabel: string,
): Promise<void> {
  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheetMeta = workbook.data.sheets?.find((sheet) => sheet.properties?.title === tabName);
  const sheetId = sheetMeta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error(`Tab "${tabName}" not found`);

  const valuesResponse = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:B`,
  });
  const rows = valuesResponse.data.values ?? [];

  let headerZeroBased = -1;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] ?? "").toString().trim();
    if (cellA === monthLabel) {
      headerZeroBased = i;
      break;
    }
  }
  if (headerZeroBased < 0) {
    console.log(`Section "${monthLabel}" not found in ${tabName} — nothing to delete`);
    return;
  }

  let nextSectionZeroBased = rows.length;
  for (let j = headerZeroBased + 1; j < rows.length; j++) {
    const nextA = (rows[j]?.[0] ?? "").toString().trim();
    const nextB = (rows[j]?.[1] ?? "").toString().trim();
    if (MONTH_HEADER_PATTERN.test(nextA) && nextA !== monthLabel) {
      nextSectionZeroBased = j;
      break;
    }
    if (!nextA && !nextB) { nextSectionZeroBased = j; break; }
  }

  const startIndex = headerZeroBased > 0 ? headerZeroBased - 1 : headerZeroBased;
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex, endIndex: nextSectionZeroBased },
        },
      }],
    },
  });
  console.log(`Deleted existing "${monthLabel}" section (${nextSectionZeroBased - startIndex} rows)`);
}

function buildTaskRow(
  page: NotionPage,
  pointFromRef: number,
  pointSource: PointSource,
): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  const notionPoint = pointNumberOf(page, pointSource);
  const finalPoint = pointFromRef > 0 ? pointFromRef : notionPoint;

  row[COLUMN_INDEX.month] = "";
  row[COLUMN_INDEX.title] = titleOf(page);
  row[COLUMN_INDEX.link] = `https://www.notion.so/${page.id.replace(/-/g, "")}`;
  row[COLUMN_INDEX.app] = tagNamesOf(page).map(toSheetApp).join(", ");
  row[COLUMN_INDEX.status] = toSheetStatus(statusOf(page));
  row[COLUMN_INDEX.point] = String(finalPoint);
  row[COLUMN_INDEX.money] = "";
  row[COLUMN_INDEX.assignees] = assigneeNamesOf(page).join(", ");
  row[COLUMN_INDEX.followers] = followerNamesOf(page).join(", ");
  return row;
}

function buildHeaderRow(monthLabel: string, headerRowOneBased: number, taskCount: number, role: string): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = monthLabel;
  if (taskCount === 0) {
    row[COLUMN_INDEX.point] = "0";
    row[COLUMN_INDEX.money] = "0";
    return row;
  }
  const firstTaskRow = headerRowOneBased + 1;
  const lastTaskRow = headerRowOneBased + taskCount;
  const pointCol = columnLetter(COLUMN_INDEX.point);
  row[COLUMN_INDEX.point] = `=SUM(${pointCol}${firstTaskRow}:${pointCol}${lastTaskRow})`;
  row[COLUMN_INDEX.money] = moneyFormulaForRole(role, pointCol, headerRowOneBased);
  return row;
}

async function appendSection(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  monthLabel: string,
  role: string,
  taskRows: string[][],
): Promise<void> {
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:${columnLetter(COLUMN_INDEX.note)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...SHEET_COLUMN_HEADERS]] },
  });

  const valuesResponse = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:B`,
  });
  const allRows = valuesResponse.data.values ?? [];
  const existingRowCount = allRows.length;
  const writeStartRow = existingRowCount + 2;
  const lastWriteRow = writeStartRow + taskRows.length;

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheetMeta = workbook.data.sheets?.find((sheet) => sheet.properties?.title === tabName);
  const sheetId = sheetMeta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error(`Tab "${tabName}" not found`);
  const currentRowCount = sheetMeta?.properties?.gridProperties?.rowCount ?? 1000;
  if (lastWriteRow > currentRowCount) {
    const expandBy = lastWriteRow - currentRowCount + 10;
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: "ROWS", length: expandBy } }],
      },
    });
    console.log(`Expanded grid by ${expandBy} rows to fit ${lastWriteRow}`);
  }

  const headerRow = buildHeaderRow(monthLabel, writeStartRow, taskRows.length, role);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${writeStartRow}:${columnLetter(COLUMN_INDEX.note)}${lastWriteRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headerRow, ...taskRows] },
  });
  console.log(`Wrote ${taskRows.length} task rows starting at row ${writeStartRow + 1}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const config = loadConfig();

  const members = await readMembers();
  const member = members.find((m) => m.tabName === args.tab);
  if (!member) throw new Error(`Tab "${args.tab}" not in Members`);
  const role = member.role;
  const STORY_POINT_ROLES = new Set(["po", "designer"]);
  const pointSource: PointSource = STORY_POINT_ROLES.has(role.trim().toLowerCase())
    ? "story_point"
    : "size_card";

  console.log(`Importing ${args.tab} (${role}) for ${args.monthLabel} from reference month ${args.refMonth}`);

  const refTasks = await fetchReferenceMonthTasks(args.refSheet, args.refGid, args.refMonth);
  console.log(`Reference: ${refTasks.length} tasks`);
  const refTotalPoints = refTasks.reduce((sum, task) => sum + task.pointFromRef, 0);
  console.log(`Reference total points: ${refTotalPoints}`);

  const pageMap = await fetchNotionPagesByIds(config.notionApiKey, refTasks.map((task) => task.pageId));
  console.log(`Notion: fetched ${pageMap.size}/${refTasks.length} pages`);

  const sheetsApi = buildSheetsApi(config.googleServiceAccountKeyFile);
  await deleteSectionRows(sheetsApi, config.googleSheetsId, args.tab, args.monthLabel);

  const taskRows: string[][] = [];
  for (const refTask of refTasks) {
    const page = pageMap.get(refTask.pageId);
    if (!page) {
      console.warn(`  ✗ skip ${refTask.pageId} — Notion fetch missing`);
      continue;
    }
    taskRows.push(buildTaskRow(page, refTask.pointFromRef, pointSource));
  }
  for (let index = 0; index < taskRows.length; index++) {
    taskRows[index][COLUMN_INDEX.month] = String(index + 1);
  }

  await appendSection(sheetsApi, config.googleSheetsId, args.tab, args.monthLabel, role, taskRows);
  await formatSection({
    sheetsApi,
    spreadsheetId: config.googleSheetsId,
    tabName: args.tab,
    monthLabel: args.monthLabel,
  });

  const finalPoints = taskRows.reduce((sum, row) => sum + (Number(row[COLUMN_INDEX.point]) || 0), 0);
  console.log(`✔ Done — ${taskRows.length} tasks, ${finalPoints} points`);
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
