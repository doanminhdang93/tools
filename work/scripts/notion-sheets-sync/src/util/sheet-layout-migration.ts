import type { SheetsClient } from "../sheets/client.ts";
import type { Logger } from "../logger.ts";
import {
  COLUMN_INDEX,
  SHEET_COLUMN_HEADERS,
  PO_LAYOUT_HEADERS,
  PO_LAYOUT_COLUMN_INDEX,
  poLayoutMoneyFormula,
  columnLetter,
} from "../constants.ts";
import { parseTab } from "../sheets/parser.ts";

const REVIEW_POINT_HEADER_TEXT = "Review point";
const TASK_TYPE_HEADER_TEXT = "Task type";

export async function migrateLayoutIfNeeded(
  tabName: string,
  rawRows: string[][],
  sheets: SheetsClient,
  logger: Logger,
): Promise<string[][]> {
  if (rawRows.length === 0) {
    const fresh = [[...SHEET_COLUMN_HEADERS] as string[]];
    await sheets.writeRange(tabName, 1, fresh);
    return fresh;
  }

  const header = rawRows[0] ?? [];
  if (header[PO_LAYOUT_COLUMN_INDEX.taskType] === TASK_TYPE_HEADER_TEXT) {
    return rawRows;
  }
  if (header[COLUMN_INDEX.reviewPoint] === REVIEW_POINT_HEADER_TEXT) {
    return rawRows;
  }

  logger.info(`[${tabName}] migrating layout: inserting "Review point" column at G`);
  const migrated = rawRows.map((row, rowIndex) => {
    if (rowIndex === 0) return [...SHEET_COLUMN_HEADERS] as string[];
    const shifted = [...row];
    shifted.splice(COLUMN_INDEX.reviewPoint, 0, "");
    return shifted;
  });

  await sheets.writeRange(tabName, 1, migrated);
  return migrated;
}

export async function readMigratedTabValues(
  sheets: SheetsClient,
  tabName: string,
  logger: Logger,
): Promise<string[][]> {
  const raw = await sheets.readTabValues(tabName);
  return migrateLayoutIfNeeded(tabName, raw, sheets, logger);
}

export async function migratePoLayoutIfNeeded(
  tabName: string,
  rawRows: string[][],
  sheets: SheetsClient,
  logger: Logger,
): Promise<string[][]> {
  if (rawRows.length === 0) {
    const fresh = [[...PO_LAYOUT_HEADERS] as string[]];
    await sheets.writeRange(tabName, 1, fresh);
    return fresh;
  }

  const header = rawRows[0] ?? [];
  if (header[PO_LAYOUT_COLUMN_INDEX.taskType] === TASK_TYPE_HEADER_TEXT) {
    return rawRows;
  }

  logger.info(`[${tabName}] migrating to PO layout (Task type / BA Point / Test point)`);

  const parsedOldLayout = parseTab(rawRows);

  const migrated: string[][] = rawRows.map((row, rowIndex) => {
    if (rowIndex === 0) return [...PO_LAYOUT_HEADERS] as string[];
    return [
      row[0] ?? "",
      row[1] ?? "",
      row[2] ?? "",
      row[3] ?? "",
      row[4] ?? "",
      "",
      row[5] ?? "",
      "",
      row[7] ?? "",
      row[8] ?? "",
      row[9] ?? "",
      row[10] ?? "",
    ];
  });

  for (const section of parsedOldLayout.sections) {
    const headerZeroBased = section.headerRowIndex - 1;
    const taskCount = section.taskRows.length;
    const headerRow = migrated[headerZeroBased];
    if (!headerRow) continue;

    if (taskCount === 0) {
      headerRow[PO_LAYOUT_COLUMN_INDEX.baPoint] = "0";
      headerRow[PO_LAYOUT_COLUMN_INDEX.testPoint] = "0";
      headerRow[PO_LAYOUT_COLUMN_INDEX.money] = "0";
      continue;
    }

    const firstTaskOneBased = section.firstTaskRowIndex;
    const lastTaskOneBased = section.lastRowIndex;
    const baCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.baPoint);
    const testCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.testPoint);
    headerRow[PO_LAYOUT_COLUMN_INDEX.baPoint] = `=SUM(${baCol}${firstTaskOneBased}:${baCol}${lastTaskOneBased})`;
    headerRow[PO_LAYOUT_COLUMN_INDEX.testPoint] = `=SUM(${testCol}${firstTaskOneBased}:${testCol}${lastTaskOneBased})`;
    headerRow[PO_LAYOUT_COLUMN_INDEX.money] = poLayoutMoneyFormula(
      section.headerRowIndex,
      firstTaskOneBased,
      lastTaskOneBased,
    );
  }

  await sheets.writeRange(tabName, 1, migrated);
  return migrated;
}
