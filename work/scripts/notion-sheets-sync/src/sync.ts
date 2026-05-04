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
  COLUMN_INDEX,
  USER_OWNED_COLUMNS,
  REVIEW_ELIGIBLE_ROLES,
  columnLetter,
  isSyncableStatus,
  toSheetApp,
  toSheetStatus,
} from "./constants.ts";
import { migrateLayoutIfNeeded } from "./util/sheet-layout-migration.ts";
import { firstInstantOfMonth } from "./util/month.ts";
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
import {
  pagesAsReviewer,
  buildCrossTabReviewFormula,
  type PageRowLocation,
} from "./review-points.ts";
import type { Logger } from "./logger.ts";

const LEGACY_REVIEW_NOTE_PATTERN = /^Review \(Sublead\)/;
const SUBLEAD_ROLE = "sublead";

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
  pageIdToRowMap?: Map<string, PageRowLocation>;
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
    pageIdToRowMap,
  } = args;
  const pointRate = pointRateForRole(role);

  const rawRows = await sheets.readTabValues(tabName);
  const existingRows = await migrateLayoutIfNeeded(tabName, rawRows, sheets, logger);
  const parsed = parseTab(existingRows);
  const columnABackgrounds = await sheets.readColumnABackgrounds(tabName);

  const targetMonthLabel =
    targetMonthOverride ?? resolveTargetMonthLabel(parsed, columnABackgrounds, now);

  const windowStart = firstInstantOfMonth(targetMonthLabel);
  const windowEnd = windowEndOverride ?? now;

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

  const normalizedRole = role.trim().toLowerCase();
  const isReviewEligible = REVIEW_ELIGIBLE_ROLES.has(normalizedRole);
  const isSublead = normalizedRole === SUBLEAD_ROLE;

  const subleadHeaderFormula = isSublead && pageIdToRowMap
    ? buildCrossTabReviewFormula(
        pagesAsReviewer(allPages, assigneeName, windowStart, windowEnd, pageIdsInOtherSections),
        pageIdToRowMap,
        columnLetter(COLUMN_INDEX.reviewPoint),
      )
    : null;

  const preservedRows = collectPreservedExistingRows(
    existingSection,
    candidatePages,
    pageIdsInOtherSections,
  );

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

  const writeStartRow = existingSection
    ? existingSection.headerRowIndex
    : parsed.totalRowCount + 2;

  const pointColLetter = columnLetter(COLUMN_INDEX.point);
  for (let index = 0; index < allTaskRows.length; index++) {
    while (allTaskRows[index].length < SHEET_COLUMN_COUNT) {
      allTaskRows[index].push("");
    }
    allTaskRows[index][COLUMN_INDEX.month] = String(index + 1);
    if (isReviewEligible) {
      const sheetRow = writeStartRow + 1 + index;
      allTaskRows[index][COLUMN_INDEX.reviewPoint] = `=${pointColLetter}${sheetRow}*0.2`;
    }
  }

  const totalPoints = allTaskRows.reduce(
    (sum, row) => sum + (parseFloat(row[COLUMN_INDEX.point]) || 0),
    0,
  );
  const totalMoney = totalPoints * pointRate;
  const headerRow = buildMonthHeaderRow(
    targetMonthLabel,
    writeStartRow,
    allTaskRows.length,
    role,
    isReviewEligible,
    subleadHeaderFormula,
  );

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
        applyPushedPointToPage(intent.page, targetField, intent.point);
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
    const note = taskRow[COLUMN_INDEX.note] ?? "";
    if (LEGACY_REVIEW_NOTE_PATTERN.test(note)) continue;

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
    const note = taskRow[COLUMN_INDEX.note] ?? "";
    if (LEGACY_REVIEW_NOTE_PATTERN.test(note)) continue;

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

function applyPushedPointToPage(page: NotionPage, field: PointSource, newPoint: number): void {
  const propertyName = field === "story_point" ? "Story Point" : "Size Card";
  page.properties[propertyName] = {
    type: "select",
    select: { name: String(newPoint) },
  } as NotionPage["properties"][string];
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
  isReviewEligible: boolean,
  subleadHeaderFormula: string | null,
): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.month] = monthLabel;

  if (taskRowCount === 0) {
    row[COLUMN_INDEX.point] = "0";
    row[COLUMN_INDEX.money] = "0";
    if (isReviewEligible) {
      row[COLUMN_INDEX.reviewPoint] = subleadHeaderFormula ?? "0";
    }
    return row;
  }

  const firstTaskRow = headerRowIndex + 1;
  const lastTaskRow = headerRowIndex + taskRowCount;
  const pointCol = columnLetter(COLUMN_INDEX.point);
  row[COLUMN_INDEX.point] = `=SUM(${pointCol}${firstTaskRow}:${pointCol}${lastTaskRow})`;
  row[COLUMN_INDEX.money] = moneyFormulaForRole(role, pointCol, headerRowIndex);
  if (isReviewEligible) {
    if (subleadHeaderFormula) {
      row[COLUMN_INDEX.reviewPoint] = subleadHeaderFormula;
    } else {
      const reviewCol = columnLetter(COLUMN_INDEX.reviewPoint);
      row[COLUMN_INDEX.reviewPoint] = `=SUM(${reviewCol}${firstTaskRow}:${reviewCol}${lastTaskRow})`;
    }
  }
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
