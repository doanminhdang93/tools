import type { SheetsClient } from "./sheets/client.ts";
import type { NotionPage } from "./notion/client.ts";
import { filterByAssignee } from "./notion/client.ts";
import type { Logger } from "./logger.ts";
import type { Member } from "./util/members.ts";
import {
  COLUMN_INDEX,
  MONTH_HEADER_PATTERN,
  SHEET_COLUMN_COUNT,
  columnLetter,
  isSyncableStatus,
  toSheetApp,
  toSheetStatus,
  moneyFormulaForRole,
} from "./constants.ts";
import {
  titleOf,
  statusOf,
  tagNamesOf,
  sizeCardNumberOf,
  assigneeNamesOf,
  followerNamesOf,
  createdTimeOf,
} from "./notion/fields.ts";
import { firstInstantOfMonth, lastInstantOfMonth } from "./util/month.ts";
import { formatSection } from "./format-section.ts";

const COASSIGNEE_ROLES = new Set(["developer", "sublead", "po", "designer"]);

export interface SyncTesterArgs {
  testerTab: string;
  testerNotionName: string;
  testerRole: string;
  monthLabel: string;
  members: Member[];
  allPages: NotionPage[];
  sheets: SheetsClient;
  logger: Logger;
}

export interface SyncTesterResult {
  tabName: string;
  monthLabel: string;
  totalPoints: number;
  taskCount: number;
}

interface TaskEntry {
  title: string;
  notionUrl: string;
  app: string;
  status: string;
  point: string;
  assignees: string;
  followers: string;
  source: string;
}

export async function syncTesterTab(args: SyncTesterArgs): Promise<SyncTesterResult> {
  const { testerTab, testerNotionName, testerRole, monthLabel, members, allPages, sheets, logger } = args;
  logger.info(`[${testerTab}] tester sync — month=${monthLabel}, notion="${testerNotionName}"`);

  const coassigneeMembers = members.filter((member) =>
    COASSIGNEE_ROLES.has(member.role.trim().toLowerCase()),
  );

  const tasksByUrl = new Map<string, TaskEntry>();

  for (const dev of coassigneeMembers) {
    const rows = await sheets.readTabValues(dev.tabName);
    for (const taskRow of collectTaskRows(rows, monthLabel)) {
      const assigneeList = (taskRow[COLUMN_INDEX.assignees] ?? "")
        .split(",")
        .map((name) => name.trim());
      if (!assigneeList.includes(testerNotionName)) continue;
      const url = (taskRow[COLUMN_INDEX.link] ?? "").trim();
      if (!url) continue;
      tasksByUrl.set(url, {
        title: taskRow[COLUMN_INDEX.title] ?? "",
        notionUrl: url,
        app: taskRow[COLUMN_INDEX.app] ?? "",
        status: taskRow[COLUMN_INDEX.status] ?? "",
        point: (taskRow[COLUMN_INDEX.point] ?? "").trim(),
        assignees: taskRow[COLUMN_INDEX.assignees] ?? "",
        followers: taskRow[COLUMN_INDEX.followers] ?? "",
        source: dev.tabName,
      });
    }
  }
  logger.info(`[${testerTab}] from coassignee tabs: ${tasksByUrl.size} task(s)`);

  const windowStart = firstInstantOfMonth(monthLabel);
  const windowEnd = lastInstantOfMonth(monthLabel);

  const myPages = filterByAssignee(allPages, testerNotionName);
  let soloAdded = 0;
  for (const page of myPages) {
    if (!isSyncableStatus(statusOf(page))) continue;
    const assignees = assigneeNamesOf(page);
    if (assignees.length !== 1) continue;
    if (assignees[0] !== testerNotionName) continue;

    const createdIso = createdTimeOf(page);
    if (!createdIso) continue;
    const createdAt = new Date(createdIso);
    if (createdAt < windowStart || createdAt > windowEnd) continue;

    const url = `https://www.notion.so/${page.id.replace(/-/g, "")}`;
    if (tasksByUrl.has(url)) continue;
    tasksByUrl.set(url, {
      title: titleOf(page),
      notionUrl: url,
      app: tagNamesOf(page).map(toSheetApp).join(", "),
      status: toSheetStatus(statusOf(page)),
      point: String(sizeCardNumberOf(page)),
      assignees: assigneeNamesOf(page).join(", "),
      followers: followerNamesOf(page).join(", "),
      source: "(Notion sole)",
    });
    soloAdded++;
  }
  logger.info(`[${testerTab}] sole-tester additions: ${soloAdded}`);

  const preservedTesterRows = await collectPreservedTesterSectionRows(
    sheets,
    testerTab,
    monthLabel,
    tasksByUrl,
  );
  if (preservedTesterRows.length > 0) {
    logger.info(`[${testerTab}] preserved ${preservedTesterRows.length} existing row(s) outside candidate filter`);
  }
  for (const preserved of preservedTesterRows) tasksByUrl.set(preserved.notionUrl, preserved);

  const tasks = [...tasksByUrl.values()];
  await replaceMonthSection(sheets, testerTab, monthLabel, testerRole, tasks, logger);
  await formatSection({
    sheetsApi: sheets.rawApi,
    spreadsheetId: sheets.spreadsheetId,
    tabName: testerTab,
    monthLabel,
  });

  const totalPoints = tasks.reduce(
    (sum, task) => sum + (Number((task.point ?? "").replace(/,/g, "")) || 0),
    0,
  );
  return { tabName: testerTab, monthLabel, totalPoints, taskCount: tasks.length };
}

async function collectPreservedTesterSectionRows(
  sheets: SheetsClient,
  testerTab: string,
  monthLabel: string,
  rebuiltTasksByUrl: Map<string, TaskEntry>,
): Promise<TaskEntry[]> {
  const rows = await sheets.readTabValues(testerTab);
  const sectionRows = collectTaskRows(rows, monthLabel);

  const preserved: TaskEntry[] = [];
  for (const row of sectionRows) {
    const url = (row[COLUMN_INDEX.link] ?? "").trim();
    if (!url) continue;
    if (rebuiltTasksByUrl.has(url)) continue;

    preserved.push({
      title: row[COLUMN_INDEX.title] ?? "",
      notionUrl: url,
      app: row[COLUMN_INDEX.app] ?? "",
      status: row[COLUMN_INDEX.status] ?? "",
      point: (row[COLUMN_INDEX.point] ?? "").trim(),
      assignees: row[COLUMN_INDEX.assignees] ?? "",
      followers: row[COLUMN_INDEX.followers] ?? "",
      source: "(preserved)",
    });
  }
  return preserved;
}

function collectTaskRows(rows: string[][], monthLabel: string): string[][] {
  const taskRows: string[][] = [];
  let inSection = false;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] ?? "").toString().trim();
    if (cellA === monthLabel) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (MONTH_HEADER_PATTERN.test(cellA) && cellA !== monthLabel) break;
    const title = (rows[i]?.[COLUMN_INDEX.title] ?? "").toString().trim();
    if (!title) continue;
    taskRows.push((rows[i] ?? []).map((cell) => (cell ?? "").toString()));
  }
  return taskRows;
}

async function replaceMonthSection(
  sheets: SheetsClient,
  tabName: string,
  monthLabel: string,
  role: string,
  tasks: TaskEntry[],
  logger: Logger,
): Promise<void> {
  const workbook = await sheets.rawApi.spreadsheets.get({ spreadsheetId: sheets.spreadsheetId });
  const sheetMeta = workbook.data.sheets?.find((sheet) => sheet.properties?.title === tabName);
  const sheetId = sheetMeta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab "${tabName}" not found`);
  }
  const currentRowCount = sheetMeta?.properties?.gridProperties?.rowCount ?? 1000;

  const existingRows = await sheets.readTabValues(tabName);
  let headerZeroBased = -1;
  let nextSectionZeroBased = existingRows.length;
  for (let i = 0; i < existingRows.length; i++) {
    const cellA = (existingRows[i]?.[0] ?? "").toString().trim();
    if (cellA === monthLabel) {
      headerZeroBased = i;
      for (let j = i + 1; j < existingRows.length; j++) {
        const nextA = (existingRows[j]?.[0] ?? "").toString().trim();
        if (nextA && nextA !== monthLabel) {
          nextSectionZeroBased = j;
          break;
        }
      }
      break;
    }
  }

  if (headerZeroBased >= 0 && nextSectionZeroBased > headerZeroBased) {
    await sheets.rawApi.spreadsheets.batchUpdate({
      spreadsheetId: sheets.spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: headerZeroBased, endIndex: nextSectionZeroBased },
          },
        }],
      },
    });
    logger.info(`[${tabName}] cleared old "${monthLabel}" section (${nextSectionZeroBased - headerZeroBased} rows)`);
  }

  const refreshedRows = await sheets.readTabValues(tabName);
  const writeStartRow = refreshedRows.length + 2;
  const rowsNeeded = writeStartRow + tasks.length;
  if (rowsNeeded > currentRowCount) {
    const expandBy = rowsNeeded - currentRowCount + 10;
    await sheets.rawApi.spreadsheets.batchUpdate({
      spreadsheetId: sheets.spreadsheetId,
      requestBody: {
        requests: [{
          appendDimension: { sheetId, dimension: "ROWS", length: expandBy },
        }],
      },
    });
    logger.info(`[${tabName}] expanded grid by ${expandBy} rows to fit ${rowsNeeded}`);
  }

  const pointCol = columnLetter(COLUMN_INDEX.point);
  const headerRow = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  headerRow[COLUMN_INDEX.month] = monthLabel;
  if (tasks.length === 0) {
    headerRow[COLUMN_INDEX.point] = "0";
    headerRow[COLUMN_INDEX.money] = "0";
  } else {
    const firstTaskRow = writeStartRow + 1;
    const lastTaskRow = writeStartRow + tasks.length;
    headerRow[COLUMN_INDEX.point] = `=SUM(${pointCol}${firstTaskRow}:${pointCol}${lastTaskRow})`;
    headerRow[COLUMN_INDEX.money] = moneyFormulaForRole(role, pointCol, writeStartRow);
  }

  const taskRowsAsArrays = tasks.map((task, index) => {
    const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
    row[COLUMN_INDEX.month] = String(index + 1);
    row[COLUMN_INDEX.title] = task.title;
    row[COLUMN_INDEX.link] = task.notionUrl;
    row[COLUMN_INDEX.app] = task.app;
    row[COLUMN_INDEX.status] = task.status;
    row[COLUMN_INDEX.point] = task.point;
    row[COLUMN_INDEX.assignees] = task.assignees;
    row[COLUMN_INDEX.followers] = task.followers;
    return row;
  });

  await sheets.writeRange(tabName, writeStartRow, [headerRow, ...taskRowsAsArrays]);
  const totalPoints = tasks.reduce(
    (sum, task) => sum + (Number(task.point.replace(/,/g, "")) || 0),
    0,
  );
  logger.info(`[${tabName}] done — ${monthLabel} tasks=${tasks.length} points=${totalPoints}`);
}
