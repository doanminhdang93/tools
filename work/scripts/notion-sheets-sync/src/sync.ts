import type { Client as NotionClient } from "@notionhq/client";
import type { SheetsClient } from "./sheets/client.ts";
import type { NotionPage } from "./notion/client.ts";
import { filterByAssignee } from "./notion/client.ts";
import { pushPointToNotion } from "./notion/update.ts";
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
import { firstInstantOfMonth, lastInstantOfMonth } from "./util/month.ts";
import { resolveTargetMonthLabel } from "./resolve-target.ts";
import { formatSection } from "./format-section.ts";
import { buildNotionUrl, extractPageIdFromUrl, normalizeNotionPageId } from "./notion/url.ts";
import {
  titleOf,
  statusOf,
  tagNamesOf,
  pointNumberOf,
  createdTimeOf,
  assigneeNamesOf,
  followerNamesOf,
  storyPointNumberOf,
  sizeCardNumberOf,
  type PointSource,
} from "./notion/fields.ts";
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
  windowEndOverride?: Date;
  notionClient?: NotionClient;
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
    windowEndOverride,
    notionClient,
  } = args;
  const pointRate = pointRateForRole(role);

  await sheets.writeRange(tabName, 1, [[...SHEET_COLUMN_HEADERS]]);

  const existingRows = await sheets.readTabValues(tabName);
  const parsed = parseTab(existingRows);
  const columnABackgrounds = await sheets.readColumnABackgrounds(tabName);

  const targetMonthLabel =
    targetMonthOverride ?? resolveTargetMonthLabel(parsed, columnABackgrounds, now);

  const windowStart = firstInstantOfMonth(targetMonthLabel);
  const defaultWindowEnd = targetMonthOverride ? lastInstantOfMonth(targetMonthLabel) : now;
  const windowEnd = windowEndOverride ?? defaultWindowEnd;

  logger.info(
    `[${tabName}] syncing ${targetMonthLabel} (created_time window ${windowStart.toISOString()} → ${windowEnd.toISOString()}) for ${assigneeName}`,
  );

  const existingSection = findSection(parsed, targetMonthLabel);
  const pageIdsInOtherSections = collectPageIdsOutsideCurrentSection(parsed, targetMonthLabel);
  const candidatePages = pagesInCandidateWindow(
    allPages,
    assigneeName,
    windowStart,
    windowEnd,
    pageIdsInOtherSections,
  );
  candidatePages.sort(byCreatedTimeAscending);

  const preservedRows = collectPreservedExistingRows(existingSection, candidatePages, pageIdsInOtherSections);

  logSyncedTasks(logger, tabName, candidatePages, pointSource);
  if (preservedRows.length > 0) {
    logger.info(`[${tabName}] preserved ${preservedRows.length} existing row(s) outside candidate filter`);
  }

  const existingRowByPageId = indexTaskRowsByPageId(existingSection);
  const sheetPointByPageId = collectSheetPointsByPageId(existingSection);

  const pushIntents: { page: NotionPage; point: number }[] = [];
  const finalPointByPageId = new Map<string, number>();
  for (const page of candidatePages) {
    const normalizedId = normalizeNotionPageId(page.id);
    const sheetPoint = sheetPointByPageId.get(normalizedId) ?? 0;
    const notionPoint = pointNumberOf(page, pointSource);
    if (sheetPoint > 0 && sheetPoint !== notionPoint) {
      finalPointByPageId.set(normalizedId, sheetPoint);
      pushIntents.push({ page, point: sheetPoint });
    } else {
      finalPointByPageId.set(normalizedId, notionPoint);
    }
  }

  const newTaskRows = candidatePages.map((page) => {
    const normalizedId = normalizeNotionPageId(page.id);
    return buildTaskRow(
      page,
      existingRowByPageId.get(normalizedId),
      pointSource,
      finalPointByPageId.get(normalizedId),
    );
  });

  const allTaskRows = [...preservedRows, ...newTaskRows];
  for (let index = 0; index < allTaskRows.length; index++) {
    allTaskRows[index][COLUMN_INDEX.month] = String(index + 1);
  }

  const writeStartRow = existingSection
    ? existingSection.headerRowIndex
    : parsed.totalRowCount + 2;

  const totalPoints = allTaskRows.reduce(
    (sum, row) => sum + (parseFloat(row[COLUMN_INDEX.point]) || 0),
    0,
  );
  const totalMoney = totalPoints * pointRate;
  const headerRow = buildMonthHeaderRow(targetMonthLabel, writeStartRow, allTaskRows.length, role);

  await sheets.writeRange(tabName, writeStartRow, [headerRow, ...allTaskRows]);

  if (existingSection) {
    const newLastRow = writeStartRow + allTaskRows.length;
    if (newLastRow < existingSection.lastRowIndex) {
      await sheets.clearRows(tabName, newLastRow + 1, existingSection.lastRowIndex);
    }
  }

  await formatSection({
    sheetsApi: sheets.rawApi,
    spreadsheetId: sheets.spreadsheetId,
    tabName,
    monthLabel: targetMonthLabel,
  });

  if (notionClient && pushIntents.length > 0) {
    logger.info(`[${tabName}] pushing ${pushIntents.length} sheet-overridden points back to Notion`);
    for (const intent of pushIntents) {
      const targetField = pickPushTargetField(intent.page, pointSource);
      const result = await pushPointToNotion({
        client: notionClient,
        pageId: intent.page.id,
        point: intent.point,
        source: targetField,
      });
      const fieldLabel = targetField === "story_point" ? "Story Point" : "Size Card";
      const shortId = intent.page.id.slice(0, 8);
      if (result.ok) {
        logger.info(`[${tabName}]   ✔ ${shortId} → ${fieldLabel}=${intent.point}`);
      } else {
        logger.warn(`[${tabName}]   ✗ ${shortId} ${fieldLabel}=${intent.point} failed: ${result.reason}`);
      }
    }
  }

  logger.info(
    `[${tabName}] done — ${targetMonthLabel} tasks=${allTaskRows.length} points=${totalPoints} money=${totalMoney.toLocaleString("en-US")}`,
  );

  return {
    tabName,
    monthLabel: targetMonthLabel,
    totalPoints,
    totalMoney,
    taskCount: allTaskRows.length,
    sectionCreated: !existingSection,
  };
}

function pagesInCandidateWindow(
  allPages: NotionPage[],
  assigneeName: string,
  windowStart: Date,
  windowEnd: Date,
  pageIdsAlreadyInOtherSections: Set<string>,
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

    return true;
  });
}

function collectPreservedExistingRows(
  existingSection: MonthSection | undefined,
  candidatePages: NotionPage[],
  pageIdsInOtherSections: Set<string>,
): string[][] {
  if (!existingSection) return [];

  const candidatePageIds = new Set(candidatePages.map((page) => normalizeNotionPageId(page.id)));

  const preserved: string[][] = [];
  for (const taskRow of existingSection.taskRows) {
    const url = taskRow[COLUMN_INDEX.link] ?? "";
    const normalizedPageId = extractPageIdFromUrl(url);
    if (!normalizedPageId) {
      preserved.push(taskRow);
      continue;
    }
    if (candidatePageIds.has(normalizedPageId)) continue;
    if (pageIdsInOtherSections.has(normalizedPageId)) continue;
    preserved.push(taskRow);
  }
  return preserved;
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

function buildTaskRow(
  page: NotionPage,
  existingRow: string[] | undefined,
  pointSource: PointSource,
  overridePoint?: number,
): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = "";
  row[COLUMN_INDEX.title] = titleOf(page);
  row[COLUMN_INDEX.link] = buildNotionUrl(page.id);
  row[COLUMN_INDEX.app] = tagNamesOf(page).map(toSheetApp).join(", ");
  row[COLUMN_INDEX.status] = toSheetStatus(statusOf(page));
  row[COLUMN_INDEX.point] = String(overridePoint ?? pointNumberOf(page, pointSource));
  row[COLUMN_INDEX.money] = "";
  row[COLUMN_INDEX.assignees] = assigneeNamesOf(page).join(", ");
  row[COLUMN_INDEX.followers] = followerNamesOf(page).join(", ");

  for (const preservedIndex of USER_OWNED_COLUMNS) {
    row[preservedIndex] = existingRow?.[preservedIndex] ?? "";
  }
  return row;
}

function collectSheetPointsByPageId(section: MonthSection | undefined): Map<string, number> {
  const indexed = new Map<string, number>();
  if (!section) return indexed;

  for (const taskRow of section.taskRows) {
    const url = taskRow[COLUMN_INDEX.link] ?? "";
    const pageId = extractPageIdFromUrl(url);
    if (!pageId) continue;
    const rawPoint = (taskRow[COLUMN_INDEX.point] ?? "").toString().replace(/,/g, "").trim();
    const numericPoint = parseFloat(rawPoint);
    if (Number.isFinite(numericPoint) && numericPoint > 0) {
      indexed.set(pageId, numericPoint);
    }
  }
  return indexed;
}

function pickPushTargetField(page: NotionPage, pointSource: PointSource): PointSource {
  if (pointSource !== "story_point") return "size_card";
  if (storyPointNumberOf(page) > 0) return "story_point";
  if (sizeCardNumberOf(page) > 0) return "size_card";
  return "story_point";
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
