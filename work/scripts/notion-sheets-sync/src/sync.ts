import type { SheetsClient } from "./sheets/client.ts";
import type { NotionPage } from "./notion/client.ts";
import { filterByAssignee } from "./notion/client.ts";
import { parseTab, findSection, type ParsedTab, type MonthSection } from "./sheets/parser.ts";
import {
  pointRateForRole,
  moneyFormulaForRole,
  SHEET_COLUMN_COUNT,
  SHEET_COLUMN_HEADERS,
  COLUMN_INDEX,
  USER_OWNED_COLUMNS,
  columnLetter,
  isSyncableStatus,
  toSheetApp,
  toSheetStatus,
} from "./constants.ts";
import {
  firstInstantOfMonth,
  lastInstantOfMonth,
  previousMonthLabel,
} from "./util/month.ts";
import { resolveTargetMonthLabel } from "./resolve-target.ts";
import { buildNotionUrl, extractPageIdFromUrl, normalizeNotionPageId } from "./notion/url.ts";
import {
  titleOf,
  statusOf,
  tagNamesOf,
  pointNumberOf,
  createdTimeOf,
  assigneeNamesOf,
  followerNamesOf,
  type PointSource,
} from "./notion/fields.ts";

const DEV_ROLES = new Set(["developer", "sublead"]);
import type { Logger } from "./logger.ts";

export interface SyncTabArgs {
  tabName: string;
  assigneeName: string;
  allPages: NotionPage[];
  sheets: SheetsClient;
  logger: Logger;
  now?: Date;
  targetMonthOverride?: string;
  pointSource?: PointSource;
  role?: string;
  roleByAssigneeName?: Map<string, string>;
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
  const {
    tabName,
    assigneeName,
    allPages,
    sheets,
    logger,
    now = new Date(),
    targetMonthOverride,
    pointSource = "size_card",
    role = "",
    roleByAssigneeName,
  } = args;
  const pointRate = pointRateForRole(role);
  const isTester = role.trim().toLowerCase() === "tester";

  await sheets.writeRange(tabName, 1, [[...SHEET_COLUMN_HEADERS]]);

  const existingRows = await sheets.readTabValues(tabName);
  const parsed = parseTab(existingRows);
  const columnABackgrounds = await sheets.readColumnABackgrounds(tabName);

  const targetMonthLabel =
    targetMonthOverride ?? resolveTargetMonthLabel(parsed, columnABackgrounds, now);

  const windowStart = firstInstantOfMonth(previousMonthLabel(targetMonthLabel));
  const windowEnd = targetMonthOverride ? lastInstantOfMonth(targetMonthLabel) : now;

  logger.info(
    `[${tabName}] syncing ${targetMonthLabel} (window ${windowStart.toISOString()} → ${windowEnd.toISOString()}) for ${assigneeName}`,
  );

  const existingSection = findSection(parsed, targetMonthLabel);
  const pageIdsInOtherSections = collectPageIdsOutsideCurrentSection(parsed, targetMonthLabel);
  const candidatePages = pagesInCandidateWindow(
    allPages,
    assigneeName,
    windowStart,
    windowEnd,
    pageIdsInOtherSections,
    isTester ? { mustHaveDevCoassignee: true, roleByAssigneeName: roleByAssigneeName ?? new Map() } : undefined,
  );
  candidatePages.sort(byCreatedTimeAscending);

  logSyncedTasks(logger, tabName, candidatePages, pointSource);

  const existingRowByPageId = indexTaskRowsByPageId(existingSection);
  const newTaskRows = candidatePages.map((page) =>
    buildTaskRow(page, existingRowByPageId.get(normalizeNotionPageId(page.id)), pointSource),
  );

  const writeStartRow = existingSection
    ? existingSection.headerRowIndex
    : parsed.totalRowCount + 2;

  const totalPoints = newTaskRows.reduce(
    (sum, row) => sum + (parseFloat(row[COLUMN_INDEX.point]) || 0),
    0,
  );
  const totalMoney = totalPoints * pointRate;
  const headerRow = buildMonthHeaderRow(targetMonthLabel, writeStartRow, newTaskRows.length, role);

  await sheets.writeRange(tabName, writeStartRow, [headerRow, ...newTaskRows]);

  if (existingSection) {
    const newLastRow = writeStartRow + newTaskRows.length;
    if (newLastRow < existingSection.lastRowIndex) {
      await sheets.clearRows(tabName, newLastRow + 1, existingSection.lastRowIndex);
    }
  }

  await applySectionFormat(sheets, tabName, parsed, targetMonthLabel, writeStartRow, logger);

  logger.info(
    `[${tabName}] done — ${targetMonthLabel} tasks=${newTaskRows.length} points=${totalPoints} money=${totalMoney.toLocaleString("en-US")}`,
  );

  return {
    tabName,
    monthLabel: targetMonthLabel,
    totalPoints,
    totalMoney,
    taskCount: newTaskRows.length,
    sectionCreated: !existingSection,
  };
}

interface TesterFilterOptions {
  mustHaveDevCoassignee: true;
  roleByAssigneeName: Map<string, string>;
}

function pagesInCandidateWindow(
  allPages: NotionPage[],
  assigneeName: string,
  windowStart: Date,
  windowEnd: Date,
  pageIdsAlreadyInOtherSections: Set<string>,
  testerFilter?: TesterFilterOptions,
): NotionPage[] {
  const assignedPages = filterByAssignee(allPages, assigneeName);
  return assignedPages.filter((page) => {
    if (!isSyncableStatus(statusOf(page))) return false;

    const createdIso = createdTimeOf(page);
    if (!createdIso) return false;

    const createdAt = new Date(createdIso);
    if (createdAt < windowStart || createdAt > windowEnd) return false;

    const normalizedPageId = normalizeNotionPageId(page.id);
    if (pageIdsAlreadyInOtherSections.has(normalizedPageId)) return false;

    if (testerFilter) return passesTesterCoassigneeRule(page, assigneeName, testerFilter.roleByAssigneeName);

    return true;
  });
}

function passesTesterCoassigneeRule(
  page: NotionPage,
  testerName: string,
  roleByAssigneeName: Map<string, string>,
): boolean {
  const assignees = assigneeNamesOf(page);
  const others = assignees.filter((name) => name !== testerName);
  if (others.length === 0) return true;
  return others.some((name) => DEV_ROLES.has((roleByAssigneeName.get(name) ?? "").trim().toLowerCase()));
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

function buildTaskRow(page: NotionPage, existingRow: string[] | undefined, pointSource: PointSource): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = "";
  row[COLUMN_INDEX.title] = titleOf(page);
  row[COLUMN_INDEX.link] = buildNotionUrl(page.id);
  row[COLUMN_INDEX.app] = tagNamesOf(page).map(toSheetApp).join(", ");
  row[COLUMN_INDEX.status] = toSheetStatus(statusOf(page));
  row[COLUMN_INDEX.point] = String(pointNumberOf(page, pointSource));
  row[COLUMN_INDEX.money] = "";
  row[COLUMN_INDEX.assignees] = assigneeNamesOf(page).join(", ");
  row[COLUMN_INDEX.followers] = followerNamesOf(page).join(", ");

  for (const preservedIndex of USER_OWNED_COLUMNS) {
    row[preservedIndex] = existingRow?.[preservedIndex] ?? "";
  }
  return row;
}

function buildMonthHeaderRow(
  monthLabel: string,
  headerRowIndex: number,
  taskRowCount: number,
  role: string,
): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = monthLabel;

  if (taskRowCount === 0) {
    row[COLUMN_INDEX.point] = "0";
    row[COLUMN_INDEX.money] = "0";
    return row;
  }

  const firstTaskRow = headerRowIndex + 1;
  const lastTaskRow = headerRowIndex + taskRowCount;
  const pointCol = columnLetter(COLUMN_INDEX.point);
  row[COLUMN_INDEX.point] = `=SUM(${pointCol}${firstTaskRow}:${pointCol}${lastTaskRow})`;
  row[COLUMN_INDEX.money] = moneyFormulaForRole(role, pointCol, headerRowIndex);
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

function logSyncedTasks(logger: Logger, tabName: string, pages: NotionPage[], pointSource: PointSource): void {
  if (pages.length === 0) {
    logger.info(`[${tabName}] no pages matched`);
    return;
  }

  for (const page of pages) {
    const shortId = page.id.slice(0, 8);
    const createdIso = createdTimeOf(page);
    const point = pointNumberOf(page, pointSource);
    logger.info(
      `[${tabName}]   ${shortId} • ${point} pts • ${createdIso.slice(0, 10)} • ${titleOf(page)}`,
    );
  }
}
