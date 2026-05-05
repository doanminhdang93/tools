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
  PO_LAYOUT_COLUMN_INDEX,
  PO_LAYOUT_COLUMN_COUNT,
  PO_LAYOUT_USER_OWNED_COLUMNS,
  PO_LAYOUT_TASK_TYPE_PO,
  PO_LAYOUT_TASK_TYPE_TESTER,
  poLayoutMoneyFormula,
  rolesIncludePo,
  columnLetter,
  isSyncableStatus,
  toSheetApp,
  toSheetStatus,
} from "./constants.ts";
import { migrateLayoutIfNeeded, migratePoLayoutIfNeeded } from "./util/sheet-layout-migration.ts";
import { kpiCycleStart } from "./util/month.ts";
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
  relatedDevTabsForReviewer,
  buildSubleadReviewFormulaFromDevTotals,
  type MemberRoleInfo,
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
  tabHeaderRowMap?: Map<string, number>;
  memberByNotionName?: Map<string, MemberRoleInfo>;
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
    tabHeaderRowMap,
    memberByNotionName,
  } = args;
  const pointRate = pointRateForRole(role);

  const isPoLayout = rolesIncludePo(role);
  const layoutColCount = isPoLayout ? PO_LAYOUT_COLUMN_COUNT : SHEET_COLUMN_COUNT;

  const rawRows = await sheets.readTabValues(tabName);
  const existingRows = isPoLayout
    ? await migratePoLayoutIfNeeded(tabName, rawRows, sheets, logger)
    : await migrateLayoutIfNeeded(tabName, rawRows, sheets, logger);
  const parsed = parseTab(existingRows);
  const columnABackgrounds = await sheets.readColumnABackgrounds(tabName);

  const targetMonthLabel =
    targetMonthOverride ?? resolveTargetMonthLabel(parsed, columnABackgrounds, now);

  const windowStart = kpiCycleStart(targetMonthLabel);
  const windowEnd = windowEndOverride ?? now;

  logger.info(
    `[${tabName}] syncing ${targetMonthLabel} (KPI cycle ${windowStart.toISOString()} → ${windowEnd.toISOString()}) for ${assigneeName}`,
  );

  const existingSection = findSection(parsed, targetMonthLabel);
  const pageIdsInOtherSections = collectPageIdsOutsideCurrentSection(parsed, targetMonthLabel);
  const syncablePageIds = new Set(
    allPages
      .filter((page) => isSyncableStatus(statusOf(page)))
      .map((page) => normalizeNotionPageId(page.id)),
  );
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

  const subleadHeaderFormula = isSublead && tabHeaderRowMap && memberByNotionName
    ? buildSubleadReviewFormulaFromDevTotals(
        relatedDevTabsForReviewer(
          pagesAsReviewer(allPages, assigneeName, windowStart, windowEnd, pageIdsInOtherSections),
          memberByNotionName,
        ),
        tabHeaderRowMap,
        columnLetter(COLUMN_INDEX.reviewPoint),
      )
    : null;

  const preservedRows = collectPreservedExistingRows(
    existingSection,
    candidatePages,
    pageIdsInOtherSections,
    syncablePageIds,
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
    if (isPoLayout) {
      return buildPoTaskRow(page, existingRowByPageId.get(normalizedId));
    }
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
    while (allTaskRows[index].length < layoutColCount) {
      allTaskRows[index].push("");
    }
    allTaskRows[index][COLUMN_INDEX.month] = String(index + 1);
    if (isReviewEligible && !isPoLayout) {
      const sheetRow = writeStartRow + 1 + index;
      allTaskRows[index][COLUMN_INDEX.reviewPoint] = `=${pointColLetter}${sheetRow}*0.2`;
    }
  }

  const totalPoints = isPoLayout
    ? allTaskRows.reduce(
        (sum, row) =>
          sum +
          (parseFloat(row[PO_LAYOUT_COLUMN_INDEX.baPoint]) || 0) +
          (parseFloat(row[PO_LAYOUT_COLUMN_INDEX.testPoint]) || 0),
        0,
      )
    : allTaskRows.reduce(
        (sum, row) => sum + (parseFloat(row[COLUMN_INDEX.point]) || 0),
        0,
      );
  const totalMoney = isPoLayout ? 0 : totalPoints * pointRate;
  const headerRow = isPoLayout
    ? buildPoMonthHeaderRow(targetMonthLabel, writeStartRow, allTaskRows.length)
    : buildMonthHeaderRow(
        targetMonthLabel,
        writeStartRow,
        allTaskRows.length,
        role,
        isReviewEligible,
        subleadHeaderFormula,
      );

  if (existingSection) {
    const newRowCount = 1 + allTaskRows.length;
    const oldRowCount = existingSection.lastRowIndex - existingSection.headerRowIndex + 1;
    if (newRowCount > oldRowCount) {
      const additional = newRowCount - oldRowCount;
      logger.info(`[${tabName}] section grew by ${additional} row(s); inserting blanks below to keep later sections intact`);
      await sheets.insertEmptyRows(tabName, existingSection.lastRowIndex + 1, additional);
    } else if (newRowCount < oldRowCount) {
      const removed = oldRowCount - newRowCount;
      logger.info(`[${tabName}] section shrank by ${removed} row(s); deleting trailing rows so later sections move up`);
      await sheets.deleteRows(tabName, writeStartRow + newRowCount, existingSection.lastRowIndex);
    }
  }

  await sheets.writeRange(tabName, writeStartRow, [headerRow, ...allTaskRows]);

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
        page: intent.page,
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
  syncablePageIds: Set<string>,
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
    if (!syncablePageIds.has(normalizedPageId)) continue;
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

function buildPoTaskRow(page: NotionPage, existingRow: string[] | undefined): string[] {
  const row = new Array<string>(PO_LAYOUT_COLUMN_COUNT).fill("");
  row[PO_LAYOUT_COLUMN_INDEX.month] = "";
  row[PO_LAYOUT_COLUMN_INDEX.title] = titleOf(page);
  row[PO_LAYOUT_COLUMN_INDEX.link] = buildNotionUrl(page.id);
  row[PO_LAYOUT_COLUMN_INDEX.app] = tagNamesOf(page).map(toSheetApp).join(", ");
  row[PO_LAYOUT_COLUMN_INDEX.status] = toSheetStatus(statusOf(page));

  const storyPoint = storyPointNumberOf(page);
  const sizeCard = sizeCardNumberOf(page);
  if (storyPoint > 0) {
    row[PO_LAYOUT_COLUMN_INDEX.taskType] = PO_LAYOUT_TASK_TYPE_PO;
    row[PO_LAYOUT_COLUMN_INDEX.baPoint] = String(storyPoint);
    row[PO_LAYOUT_COLUMN_INDEX.testPoint] = "0";
  } else if (sizeCard > 0) {
    row[PO_LAYOUT_COLUMN_INDEX.taskType] = PO_LAYOUT_TASK_TYPE_TESTER;
    row[PO_LAYOUT_COLUMN_INDEX.baPoint] = "0";
    row[PO_LAYOUT_COLUMN_INDEX.testPoint] = String(sizeCard);
  } else {
    row[PO_LAYOUT_COLUMN_INDEX.taskType] = "";
    row[PO_LAYOUT_COLUMN_INDEX.baPoint] = "0";
    row[PO_LAYOUT_COLUMN_INDEX.testPoint] = "0";
  }

  row[PO_LAYOUT_COLUMN_INDEX.money] = "";
  row[PO_LAYOUT_COLUMN_INDEX.assignees] = assigneeNamesOf(page).join(", ");
  row[PO_LAYOUT_COLUMN_INDEX.followers] = followerNamesOf(page).join(", ");

  for (const preservedIndex of PO_LAYOUT_USER_OWNED_COLUMNS) {
    const existingValue = existingRow?.[preservedIndex];
    if (existingValue !== undefined && existingValue !== "") {
      row[preservedIndex] = existingValue;
    }
  }
  return row;
}

function buildPoMonthHeaderRow(
  monthLabel: string,
  headerRowIndex: number,
  taskRowCount: number,
): string[] {
  const row = new Array<string>(PO_LAYOUT_COLUMN_COUNT).fill("");
  row[PO_LAYOUT_COLUMN_INDEX.month] = monthLabel;
  if (taskRowCount === 0) {
    row[PO_LAYOUT_COLUMN_INDEX.baPoint] = "0";
    row[PO_LAYOUT_COLUMN_INDEX.testPoint] = "0";
    row[PO_LAYOUT_COLUMN_INDEX.money] = "0";
    return row;
  }
  const firstTaskRow = headerRowIndex + 1;
  const lastTaskRow = headerRowIndex + taskRowCount;
  const baCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.baPoint);
  const testCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.testPoint);
  row[PO_LAYOUT_COLUMN_INDEX.baPoint] = `=SUM(${baCol}${firstTaskRow}:${baCol}${lastTaskRow})`;
  row[PO_LAYOUT_COLUMN_INDEX.testPoint] = `=SUM(${testCol}${firstTaskRow}:${testCol}${lastTaskRow})`;
  row[PO_LAYOUT_COLUMN_INDEX.money] = poLayoutMoneyFormula(headerRowIndex, firstTaskRow, lastTaskRow);
  return row;
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
  const existing = page.properties[propertyName];
  if (existing?.type === "number") {
    page.properties[propertyName] = {
      type: "number",
      number: newPoint,
    } as NotionPage["properties"][string];
    return;
  }
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
