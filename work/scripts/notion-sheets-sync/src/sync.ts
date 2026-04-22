import type { SheetsClient } from "./sheets.ts";
import type { NotionPage } from "./notion.ts";
import { filterByAssignee } from "./notion.ts";
import { parseTab, findSection, type MonthSection } from "./sheet-parser.ts";
import {
  POINT_VALUE_VND,
  SHEET_COLUMN_COUNT,
  COLUMN_INDEX,
  USER_OWNED_COLUMNS,
} from "./constants.ts";
import { currentMonthLabel, monthLabelFromIsoString } from "./month.ts";
import { buildNotionUrl, extractPageIdFromUrl, normalizeNotionPageId } from "./notion-url.ts";
import {
  titleOf,
  statusOf,
  firstTagNameOf,
  sizeCardNumberOf,
  createdTimeOf,
} from "./notion-fields.ts";
import type { Logger } from "./logger.ts";

export interface SyncTabArgs {
  tabName: string;
  assigneeName: string;
  allPages: NotionPage[];
  sheets: SheetsClient;
  logger: Logger;
  now?: Date;
}

export interface SyncTabResult {
  tabName: string;
  monthLabel: string;
  totalPoints: number;
  totalMoney: number;
  taskCount: number;
  sectionCreated: boolean;
}

export async function syncTab(args: SyncTabArgs): Promise<SyncTabResult> {
  const { tabName, assigneeName, allPages, sheets, logger, now = new Date() } = args;

  const monthLabel = currentMonthLabel(now);
  logger.info(`[${tabName}] syncing month ${monthLabel} for ${assigneeName}`);

  const pagesForMonth = pagesAssignedInMonth(allPages, assigneeName, monthLabel);
  pagesForMonth.sort(byCreatedTimeAscending);

  const existingRows = await sheets.readTabValues(tabName);
  const parsed = parseTab(existingRows);
  const existingSection = findSection(parsed, monthLabel);

  const existingRowByPageId = indexTaskRowsByPageId(existingSection);
  const newTaskRows = pagesForMonth.map((page) =>
    buildTaskRow(page, existingRowByPageId.get(normalizeNotionPageId(page.id))),
  );

  const totalPoints = newTaskRows.reduce(
    (sum, row) => sum + (parseFloat(row[COLUMN_INDEX.point]) || 0),
    0,
  );
  const totalMoney = totalPoints * POINT_VALUE_VND;
  const headerRow = buildMonthHeaderRow(monthLabel, totalPoints, totalMoney);

  const writeStartRow = existingSection
    ? existingSection.headerRowIndex
    : parsed.totalRowCount + 2;

  await sheets.writeRange(tabName, writeStartRow, [headerRow, ...newTaskRows]);

  if (existingSection) {
    const oldLastRow = existingSection.lastRowIndex;
    const newLastRow = writeStartRow + newTaskRows.length;
    if (newLastRow < oldLastRow) {
      await sheets.clearRows(tabName, newLastRow + 1, oldLastRow);
    }
  }

  logger.info(
    `[${tabName}] done — ${monthLabel} tasks=${newTaskRows.length} points=${totalPoints} money=${totalMoney}`,
  );

  return {
    tabName,
    monthLabel,
    totalPoints,
    totalMoney,
    taskCount: newTaskRows.length,
    sectionCreated: !existingSection,
  };
}

function pagesAssignedInMonth(
  allPages: NotionPage[],
  assigneeName: string,
  monthLabel: string,
): NotionPage[] {
  const forAssignee = filterByAssignee(allPages, assigneeName);
  return forAssignee.filter((page) => {
    const createdIso = createdTimeOf(page);
    if (!createdIso) return false;
    return monthLabelFromIsoString(createdIso) === monthLabel;
  });
}

function byCreatedTimeAscending(left: NotionPage, right: NotionPage): number {
  return createdTimeOf(left).localeCompare(createdTimeOf(right));
}

function indexTaskRowsByPageId(section: MonthSection | undefined): Map<string, string[]> {
  const indexed = new Map<string, string[]>();
  if (!section) return indexed;

  for (const taskRow of section.taskRows) {
    const url = taskRow[COLUMN_INDEX.link] ?? "";
    const pageId = extractPageIdFromUrl(url);
    if (!pageId) continue;
    indexed.set(pageId, taskRow);
  }
  return indexed;
}

function buildTaskRow(page: NotionPage, existingRow: string[] | undefined): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = "";
  row[COLUMN_INDEX.title] = titleOf(page);
  row[COLUMN_INDEX.link] = buildNotionUrl(page.id);
  row[COLUMN_INDEX.app] = firstTagNameOf(page);
  row[COLUMN_INDEX.status] = statusOf(page);
  row[COLUMN_INDEX.point] = String(sizeCardNumberOf(page));
  row[COLUMN_INDEX.money] = "";

  for (const preservedIndex of USER_OWNED_COLUMNS) {
    row[preservedIndex] = existingRow?.[preservedIndex] ?? "";
  }
  return row;
}

function buildMonthHeaderRow(monthLabel: string, totalPoints: number, totalMoney: number): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = monthLabel;
  row[COLUMN_INDEX.point] = String(totalPoints);
  row[COLUMN_INDEX.money] = String(totalMoney);
  return row;
}
