import type { SheetsClient } from "./sheets/client.ts";
import type { NotionPage } from "./notion/client.ts";
import { filterByAssignee } from "./notion/client.ts";
import { parseTab, findSection, type ParsedTab, type MonthSection } from "./sheets/parser.ts";
import {
  POINT_VALUE_VND,
  SHEET_COLUMN_COUNT,
  COLUMN_INDEX,
  USER_OWNED_COLUMNS,
  SYNCABLE_STATUSES,
} from "./constants.ts";
import { currentMonthLabel, monthLabelFromIsoString, previousMonthLabel } from "./util/month.ts";
import { buildNotionUrl, extractPageIdFromUrl, normalizeNotionPageId } from "./notion/url.ts";
import {
  titleOf,
  statusOf,
  firstTagNameOf,
  sizeCardNumberOf,
  createdTimeOf,
} from "./notion/fields.ts";
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
  const earlierMonthLabel = previousMonthLabel(monthLabel);
  logger.info(
    `[${tabName}] syncing ${monthLabel} (candidate window: ${earlierMonthLabel} + ${monthLabel}) for ${assigneeName}`,
  );

  const existingRows = await sheets.readTabValues(tabName);
  const parsed = parseTab(existingRows);
  const existingSection = findSection(parsed, monthLabel);

  const pageIdsInOtherSections = collectPageIdsOutsideCurrentSection(parsed, monthLabel);
  const candidatePages = pagesInCandidateWindow(
    allPages,
    assigneeName,
    monthLabel,
    earlierMonthLabel,
    pageIdsInOtherSections,
  );
  candidatePages.sort(byCreatedTimeAscending);

  logSyncedTasks(logger, tabName, candidatePages);

  const existingRowByPageId = indexTaskRowsByPageId(existingSection);
  const newTaskRows = candidatePages.map((page) =>
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
    const newLastRow = writeStartRow + newTaskRows.length;
    if (newLastRow < existingSection.lastRowIndex) {
      await sheets.clearRows(tabName, newLastRow + 1, existingSection.lastRowIndex);
    }
  }

  await applySectionFormat(sheets, tabName, parsed, monthLabel, writeStartRow, logger);

  logger.info(
    `[${tabName}] done — ${monthLabel} tasks=${newTaskRows.length} points=${totalPoints} money=${totalMoney.toLocaleString("en-US")}`,
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

function pagesInCandidateWindow(
  allPages: NotionPage[],
  assigneeName: string,
  currentMonthLabelValue: string,
  earlierMonthLabelValue: string,
  pageIdsAlreadyInOtherSections: Set<string>,
): NotionPage[] {
  const forAssignee = filterByAssignee(allPages, assigneeName);
  return forAssignee.filter((page) => {
    if (!SYNCABLE_STATUSES.has(statusOf(page))) return false;

    const createdIso = createdTimeOf(page);
    if (!createdIso) return false;

    const createdMonth = monthLabelFromIsoString(createdIso);
    if (createdMonth !== currentMonthLabelValue && createdMonth !== earlierMonthLabelValue) {
      return false;
    }

    const normalizedPageId = normalizeNotionPageId(page.id);
    if (pageIdsAlreadyInOtherSections.has(normalizedPageId)) return false;

    return true;
  });
}

function collectPageIdsOutsideCurrentSection(
  parsed: ParsedTab,
  currentMonth: string,
): Set<string> {
  const pageIds = new Set<string>();
  for (const section of parsed.sections) {
    if (section.monthLabel === currentMonth) continue;
    for (const taskRow of section.taskRows) {
      const url = taskRow[COLUMN_INDEX.link] ?? "";
      const pageId = extractPageIdFromUrl(url);
      if (!pageId) continue;
      pageIds.add(pageId);
    }
  }
  return pageIds;
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

async function applySectionFormat(
  sheets: SheetsClient,
  tabName: string,
  parsed: ParsedTab,
  currentMonth: string,
  headerRowIndex: number,
  logger: Logger,
): Promise<void> {
  const reference = findFormatReferenceSection(parsed, currentMonth);
  if (!reference) {
    logger.warn(`[${tabName}] no reference section found — skipping format copy`);
    return;
  }

  const referenceSeparatorRow = reference.headerRowIndex - 1;
  if (referenceSeparatorRow < 1) {
    logger.warn(`[${tabName}] reference section has no separator row — skipping format copy`);
    return;
  }

  await sheets.applySectionStyle(tabName, {
    referenceSeparatorRow,
    referenceHeaderRow: reference.headerRowIndex,
    destinationSeparatorRow: headerRowIndex - 1,
    destinationHeaderRow: headerRowIndex,
  });
}

function findFormatReferenceSection(
  parsed: ParsedTab,
  currentMonth: string,
): MonthSection | undefined {
  const candidates = parsed.sections.filter((section) => section.monthLabel !== currentMonth);
  return candidates[candidates.length - 1];
}

function logSyncedTasks(logger: Logger, tabName: string, pages: NotionPage[]): void {
  if (pages.length === 0) {
    logger.info(`[${tabName}] no pages matched`);
    return;
  }

  for (const page of pages) {
    const shortId = page.id.slice(0, 8);
    const createdIso = createdTimeOf(page);
    const point = sizeCardNumberOf(page);
    logger.info(
      `[${tabName}]   ${shortId} • ${point} pts • ${createdIso.slice(0, 10)} • ${titleOf(page)}`,
    );
  }
}
