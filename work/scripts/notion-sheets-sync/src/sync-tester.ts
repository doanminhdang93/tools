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
import { kpiCycleStart } from "./util/month.ts";
import { readMigratedTabValues } from "./util/sheet-layout-migration.ts";
import { formatSection } from "./format-section.ts";
import { parseTab, findSection } from "./sheets/parser.ts";
import { extractPageIdFromUrl, normalizeNotionPageId } from "./notion/url.ts";

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
  syncedPageIds: string[];
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

  const windowStart = kpiCycleStart(monthLabel);
  const windowEnd = new Date();

  const pagesByPageId = new Map<string, NotionPage>();
  for (const page of allPages) {
    pagesByPageId.set(normalizeNotionPageId(page.id), page);
  }

  const ownTabRows = await readMigratedTabValues(sheets, testerTab, logger);
  const pageIdsInOtherSectionsOfOwnTab = collectPageIdsOutsideTargetSection(ownTabRows, monthLabel);

  const tasksByUrl = new Map<string, TaskEntry>();

  for (const dev of coassigneeMembers) {
    const rows = await readMigratedTabValues(sheets, dev.tabName, logger);
    for (const taskRow of collectTaskRows(rows, monthLabel)) {
      const assigneeList = (taskRow[COLUMN_INDEX.assignees] ?? "")
        .split(",")
        .map((name) => name.trim());
      if (!assigneeList.includes(testerNotionName)) continue;
      const url = (taskRow[COLUMN_INDEX.link] ?? "").trim();
      if (!url) continue;

      const pageId = extractPageIdFromUrl(url);
      if (!pageId) continue;
      if (pageIdsInOtherSectionsOfOwnTab.has(pageId)) continue;
      const page = pagesByPageId.get(pageId);
      if (!page) continue;
      if (!isSyncableStatus(statusOf(page))) continue;
      const createdIso = createdTimeOf(page);
      if (!createdIso) continue;
      const createdAt = new Date(createdIso);
      if (createdAt < windowStart || createdAt > windowEnd) continue;

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
    if (pageIdsInOtherSectionsOfOwnTab.has(normalizeNotionPageId(page.id))) continue;
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

  const syncablePageIds = new Set<string>();
  for (const [pageId, page] of pagesByPageId) {
    if (isSyncableStatus(statusOf(page))) syncablePageIds.add(pageId);
  }
  const preservedTesterRows = await collectPreservedTesterSectionRows(
    sheets,
    testerTab,
    monthLabel,
    tasksByUrl,
    syncablePageIds,
    logger,
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
  const syncedPageIds = tasks
    .map((task) => extractPageIdFromUrl(task.notionUrl))
    .filter((pageId): pageId is string => pageId !== null);
  return { tabName: testerTab, monthLabel, totalPoints, taskCount: tasks.length, syncedPageIds };
}

async function collectPreservedTesterSectionRows(
  sheets: SheetsClient,
  testerTab: string,
  monthLabel: string,
  rebuiltTasksByUrl: Map<string, TaskEntry>,
  syncablePageIds: Set<string>,
  logger: Logger,
): Promise<TaskEntry[]> {
  const rows = await readMigratedTabValues(sheets, testerTab, logger);
  const sectionRows = collectTaskRows(rows, monthLabel);

  const preserved: TaskEntry[] = [];
  for (const row of sectionRows) {
    const url = (row[COLUMN_INDEX.link] ?? "").trim();
    if (!url) continue;
    if (rebuiltTasksByUrl.has(url)) continue;

    const pageId = extractPageIdFromUrl(url);
    if (pageId && !syncablePageIds.has(pageId)) continue;

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

function collectPageIdsOutsideTargetSection(rows: string[][], targetMonthLabel: string): Set<string> {
  const parsed = parseTab(rows);
  const pageIds = new Set<string>();
  for (const section of parsed.sections) {
    if (section.monthLabel === targetMonthLabel) continue;
    for (const taskRow of section.taskRows) {
      const url = (taskRow[COLUMN_INDEX.link] ?? "").trim();
      const pageId = extractPageIdFromUrl(url);
      if (!pageId) continue;
      pageIds.add(pageId);
    }
  }
  return pageIds;
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

  const existingRows = await readMigratedTabValues(sheets, tabName, logger);
  const parsed = parseTab(existingRows);

  const deleteRanges: Array<{ start: number; end: number }> = [];

  const targetSection = findSection(parsed, monthLabel);
  if (targetSection) {
    deleteRanges.push({ start: targetSection.headerRowIndex, end: targetSection.lastRowIndex });
  }

  const inSectionRows = new Set<number>();
  for (const section of parsed.sections) {
    inSectionRows.add(section.headerRowIndex);
    for (let taskIndex = 0; taskIndex < section.taskRows.length; taskIndex++) {
      inSectionRows.add(section.firstTaskRowIndex + taskIndex);
    }
  }

  const orphanRows: number[] = [];
  for (let zeroBasedIndex = 1; zeroBasedIndex < existingRows.length; zeroBasedIndex++) {
    const oneBasedRow = zeroBasedIndex + 1;
    if (inSectionRows.has(oneBasedRow)) continue;
    const row = existingRows[zeroBasedIndex] ?? [];
    const hasTitle = (row[COLUMN_INDEX.title] ?? "").toString().trim().length > 0;
    if (!hasTitle) continue;
    orphanRows.push(oneBasedRow);
  }
  if (orphanRows.length > 0) {
    let rangeStart = orphanRows[0];
    let rangeEnd = orphanRows[0];
    for (let i = 1; i < orphanRows.length; i++) {
      if (orphanRows[i] === rangeEnd + 1) {
        rangeEnd = orphanRows[i];
      } else {
        deleteRanges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = orphanRows[i];
        rangeEnd = orphanRows[i];
      }
    }
    deleteRanges.push({ start: rangeStart, end: rangeEnd });
  }

  if (deleteRanges.length > 0) {
    deleteRanges.sort((leftRange, rightRange) => rightRange.start - leftRange.start);
    const requests = deleteRanges.map((range) => ({
      deleteDimension: {
        range: { sheetId, dimension: "ROWS" as const, startIndex: range.start - 1, endIndex: range.end },
      },
    }));
    await sheets.rawApi.spreadsheets.batchUpdate({
      spreadsheetId: sheets.spreadsheetId,
      requestBody: { requests },
    });
    const targetDeleted = targetSection ? targetSection.lastRowIndex - targetSection.headerRowIndex + 1 : 0;
    const totalDeleted = deleteRanges.reduce((sum, range) => sum + (range.end - range.start + 1), 0);
    if (targetSection) {
      logger.info(`[${tabName}] cleared old "${monthLabel}" section (${targetDeleted} rows)`);
    }
    const orphansDeleted = totalDeleted - targetDeleted;
    if (orphansDeleted > 0) {
      logger.info(`[${tabName}] cleaned ${orphansDeleted} orphan task row(s) outside any section`);
    }
  }

  const refreshedRows = await readMigratedTabValues(sheets, tabName, logger);
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
    headerRow[COLUMN_INDEX.money] = moneyFormulaForRole(role, pointCol, writeStartRow, {
      firstTaskRow,
      lastTaskRow,
    });
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
