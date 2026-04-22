import type { SheetsClient, RowUpdate } from "./sheets.ts";
import type { NotionPage } from "./notion.ts";
import { filterByAssignee } from "./notion.ts";
import { propertyToCell } from "./transform.ts";
import type { ColumnConfig } from "../columns.config.ts";
import type { Logger } from "./logger.ts";

export interface SyncTabArgs {
  tabName: string;
  assigneeName: string;
  allPages: NotionPage[];
  columns: ColumnConfig[];
  sheets: SheetsClient;
  logger: Logger;
}

export interface SyncTabResult {
  tabName: string;
  filtered: number;
  updated: number;
  appended: number;
  skipped: number;
}

const MISSING_PROPERTY: NotionPage["properties"][string] = { type: "_missing" };

export async function syncTab(arguments_: SyncTabArgs): Promise<SyncTabResult> {
  const { tabName, assigneeName, allPages, columns, sheets, logger } = arguments_;

  const visibleHeaders = columns.map((column) => column.sheetHeader);
  await sheets.ensureHeaders(tabName, visibleHeaders);

  const assigneePages = filterByAssignee(allPages, assigneeName);
  logger.info(`[${tabName}] filtered ${assigneePages.length} pages for ${assigneeName}`);

  const existingRowByPageId = await sheets.readExistingRows(tabName);

  const rowsToUpdate: RowUpdate[] = [];
  const rowsToAppend: string[][] = [];
  let skippedCount = 0;

  for (const page of assigneePages) {
    const rowValues = tryBuildRow(page, columns, logger, tabName);
    if (!rowValues) {
      skippedCount++;
      continue;
    }

    const existingRowIndex = existingRowByPageId.get(page.id);
    if (existingRowIndex) {
      rowsToUpdate.push({ rowIndex: existingRowIndex, values: rowValues });
      continue;
    }
    rowsToAppend.push(rowValues);
  }

  await sheets.batchUpdateRows(tabName, rowsToUpdate);
  await sheets.appendRows(tabName, rowsToAppend);

  logger.info(
    `[${tabName}] done — updated=${rowsToUpdate.length} appended=${rowsToAppend.length} skipped=${skippedCount}`,
  );

  return {
    tabName,
    filtered: assigneePages.length,
    updated: rowsToUpdate.length,
    appended: rowsToAppend.length,
    skipped: skippedCount,
  };
}

function tryBuildRow(
  page: NotionPage,
  columns: ColumnConfig[],
  logger: Logger,
  tabName: string,
): string[] | null {
  try {
    const cells = columns.map((column) =>
      propertyToCell(page.properties[column.notionProperty] ?? MISSING_PROPERTY),
    );
    return [page.id, ...cells];
  } catch (cause) {
    logger.warn(`[${tabName}] transform failed for page ${page.id}`, cause);
    return null;
  }
}
