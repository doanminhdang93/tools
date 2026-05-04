import type { SheetsClient } from "../sheets/client.ts";
import type { Logger } from "../logger.ts";
import { COLUMN_INDEX, SHEET_COLUMN_HEADERS } from "../constants.ts";

const REVIEW_POINT_HEADER_TEXT = "Review point";

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
