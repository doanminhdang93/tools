import { google, sheets_v4 } from "googleapis";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHEET_COLUMN_COUNT } from "../constants.ts";
import { withRetry } from "../util/retry.ts";

export interface SheetsClient {
  readTabValues(tabName: string): Promise<string[][]>;
  readColumnABackgrounds(tabName: string): Promise<RgbColor[]>;
  writeRange(
    tabName: string,
    startRow: number,
    rows: string[][],
  ): Promise<void>;
  insertEmptyRows(
    tabName: string,
    beforeRow: number,
    count: number,
  ): Promise<void>;
  deleteRows(tabName: string, startRow: number, endRow: number): Promise<void>;
  ensureRowCapacity(tabName: string, rowsNeeded: number): Promise<number>;
  applySectionStyle(tabName: string, plan: SectionStylePlan): Promise<void>;
  listTabNames(): Promise<string[]>;
  rawApi: sheets_v4.Sheets;
  spreadsheetId: string;
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export function isNonDefaultFill(color: RgbColor | undefined): boolean {
  if (!color) return false;
  return color.red < 1 || color.green < 1 || color.blue < 1;
}

export interface SectionStylePlan {
  referenceSeparatorRow: number;
  referenceHeaderRow: number;
  destinationSeparatorRow: number;
  destinationHeaderRow: number;
}

const SHEETS_API_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function createSheetsClient(
  serviceAccountKeyFile: string,
  spreadsheetId: string,
): SheetsClient {
  const sheetsApi = buildSheetsApi(serviceAccountKeyFile);
  const tabSheetIdCache = new Map<string, number>();

  return {
    readTabValues: (tabName) =>
      readTabValues(sheetsApi, spreadsheetId, tabName),
    readColumnABackgrounds: (tabName) =>
      readColumnABackgrounds(sheetsApi, spreadsheetId, tabName),
    writeRange: (tabName, startRow, rows) =>
      writeRange(sheetsApi, spreadsheetId, tabName, startRow, rows),
    insertEmptyRows: (tabName, beforeRow, count) =>
      insertEmptyRows(
        sheetsApi,
        spreadsheetId,
        tabSheetIdCache,
        tabName,
        beforeRow,
        count,
      ),
    deleteRows: (tabName, startRow, endRow) =>
      deleteRows(
        sheetsApi,
        spreadsheetId,
        tabSheetIdCache,
        tabName,
        startRow,
        endRow,
      ),
    ensureRowCapacity: (tabName, rowsNeeded) =>
      ensureRowCapacity(
        sheetsApi,
        spreadsheetId,
        tabSheetIdCache,
        tabName,
        rowsNeeded,
      ),
    applySectionStyle: (tabName, plan) =>
      applySectionStyle(
        sheetsApi,
        spreadsheetId,
        tabSheetIdCache,
        tabName,
        plan,
      ),
    listTabNames: () => listTabNames(sheetsApi, spreadsheetId),
    rawApi: sheetsApi,
    spreadsheetId,
  };
}

async function insertEmptyRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetIdCache: Map<string, number>,
  tabName: string,
  beforeRow: number,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  const sheetId = await lookupTabSheetId(
    sheetsApi,
    spreadsheetId,
    tabSheetIdCache,
    tabName,
  );
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: beforeRow - 1,
              endIndex: beforeRow - 1 + count,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });
}

// Extra rows appended beyond the immediate need, so a tab that is filling up
// does not trigger a grid expansion on every single run.
const GRID_EXPANSION_HEADROOM = 10;

export function rowsToAppendFor(
  currentRowCount: number,
  rowsNeeded: number,
): number {
  if (rowsNeeded <= currentRowCount) return 0;
  return rowsNeeded - currentRowCount + GRID_EXPANSION_HEADROOM;
}

async function ensureRowCapacity(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetIdCache: Map<string, number>,
  tabName: string,
  rowsNeeded: number,
): Promise<number> {
  const response = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const matchingSheet = response.data.sheets?.find(
    (sheet) => sheet.properties?.title === tabName,
  );
  const sheetId = matchingSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab not found in spreadsheet: "${tabName}"`);
  }
  tabSheetIdCache.set(tabName, sheetId);

  const currentRowCount =
    matchingSheet?.properties?.gridProperties?.rowCount ?? 0;
  const rowsToAppend = rowsToAppendFor(currentRowCount, rowsNeeded);
  if (rowsToAppend === 0) return 0;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { appendDimension: { sheetId, dimension: "ROWS", length: rowsToAppend } },
      ],
    },
  });
  return rowsToAppend;
}

async function deleteRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetIdCache: Map<string, number>,
  tabName: string,
  startRow: number,
  endRow: number,
): Promise<void> {
  if (endRow < startRow) return;
  const sheetId = await lookupTabSheetId(
    sheetsApi,
    spreadsheetId,
    tabSheetIdCache,
    tabName,
  );
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: startRow - 1,
              endIndex: endRow,
            },
          },
        },
      ],
    },
  });
}

async function readColumnABackgrounds(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<RgbColor[]> {
  const response = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    ranges: [`${tabName}!A:A`],
    includeGridData: true,
    fields: "sheets.data.rowData.values.effectiveFormat.backgroundColor",
  });
  const rowData = response.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rowData.map((row) => {
    const color = row.values?.[0]?.effectiveFormat?.backgroundColor ?? {};
    return {
      red: color.red ?? 1,
      green: color.green ?? 1,
      blue: color.blue ?? 1,
    };
  });
}

async function listTabNames(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<string[]> {
  const response = await sheetsApi.spreadsheets.get({ spreadsheetId });
  return (response.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title ?? "")
    .filter((title) => title.length > 0);
}

function buildSheetsApi(serviceAccountKeyFile: string): sheets_v4.Sheets {
  const absolutePath = resolve(serviceAccountKeyFile);
  const credentials = JSON.parse(readFileSync(absolutePath, "utf8"));
  const googleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [SHEETS_API_SCOPE],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  return wrapSheetsApiWithRetry(sheetsApi);
}

function wrapSheetsApiWithRetry(sheetsApi: sheets_v4.Sheets): sheets_v4.Sheets {
  const spreadsheets = sheetsApi.spreadsheets;
  patchMethod(spreadsheets, "get", "spreadsheets.get");
  patchMethod(spreadsheets, "batchUpdate", "spreadsheets.batchUpdate");
  const values = spreadsheets.values;
  patchMethod(values, "get", "spreadsheets.values.get");
  patchMethod(values, "update", "spreadsheets.values.update");
  patchMethod(values, "batchUpdate", "spreadsheets.values.batchUpdate");
  return sheetsApi;
}

function patchMethod(target: object, methodName: string, label: string): void {
  const indexable = target as Record<string, unknown>;
  const original = indexable[methodName];
  if (typeof original !== "function") return;
  const boundOriginal = (original as (...args: unknown[]) => Promise<unknown>).bind(target);
  indexable[methodName] = (...args: unknown[]) =>
    withRetry(() => boundOriginal(...args), {
      label,
      onRetry: (attempt, cause) => {
        console.warn(`[sheets] ${label} attempt ${attempt} failed: ${cause.message} — retrying`);
      },
    });
}

async function readTabValues(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<string[][]> {
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:Z`,
  });
  const values = response.data.values ?? [];
  return values.map((row) => row.map((cell) => (cell ?? "").toString()));
}

async function writeRange(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  startRow: number,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  const columnCount = rows[0]?.length ?? 0;
  const lastColumnLetter = columnLetterFor(columnCount);
  const endRow = startRow + rows.length - 1;
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${startRow}:${lastColumnLetter}${endRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

async function applySectionStyle(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetIdCache: Map<string, number>,
  tabName: string,
  plan: SectionStylePlan,
): Promise<void> {
  const sheetId = await lookupTabSheetId(
    sheetsApi,
    spreadsheetId,
    tabSheetIdCache,
    tabName,
  );

  const requests: sheets_v4.Schema$Request[] = [
    paintSeparatorAcrossAllColumnsRequest(
      sheetId,
      plan.referenceSeparatorRow,
      plan.destinationSeparatorRow,
    ),
    copyFormatRequest(
      sheetId,
      plan.referenceHeaderRow,
      plan.destinationHeaderRow,
    ),
    clearDataValidationRequest(sheetId, plan.destinationSeparatorRow),
    clearDataValidationRequest(sheetId, plan.destinationHeaderRow),
  ];

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

function copyFormatRequest(
  sheetId: number,
  sourceRowOneBased: number,
  destinationRowOneBased: number,
): sheets_v4.Schema$Request {
  return {
    copyPaste: {
      source: fullWidthRowRange(sheetId, sourceRowOneBased),
      destination: fullWidthRowRange(sheetId, destinationRowOneBased),
      pasteType: "PASTE_FORMAT",
    },
  };
}

// Repeat the reference separator's column-A format across every column of the
// destination separator. The Sheets API repeats the source range when the
// destination is larger, so a 1-column source fills all SHEET_COLUMN_COUNT
// destination columns — guaranteeing a full-width purple band even if the
// reference section predates later column expansions.
function paintSeparatorAcrossAllColumnsRequest(
  sheetId: number,
  referenceSeparatorRow: number,
  destinationSeparatorRow: number,
): sheets_v4.Schema$Request {
  return {
    copyPaste: {
      source: {
        sheetId,
        startRowIndex: referenceSeparatorRow - 1,
        endRowIndex: referenceSeparatorRow,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      destination: fullWidthRowRange(sheetId, destinationSeparatorRow),
      pasteType: "PASTE_FORMAT",
    },
  };
}

function clearDataValidationRequest(
  sheetId: number,
  rowOneBased: number,
): sheets_v4.Schema$Request {
  return {
    setDataValidation: {
      range: fullWidthRowRange(sheetId, rowOneBased),
      // omitting `rule` clears data validation on the range
    },
  };
}

function fullWidthRowRange(
  sheetId: number,
  rowOneBased: number,
): sheets_v4.Schema$GridRange {
  return {
    sheetId,
    startRowIndex: rowOneBased - 1,
    endRowIndex: rowOneBased,
    startColumnIndex: 0,
    endColumnIndex: SHEET_COLUMN_COUNT,
  };
}

async function lookupTabSheetId(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetIdCache: Map<string, number>,
  tabName: string,
): Promise<number> {
  const cached = tabSheetIdCache.get(tabName);
  if (cached !== undefined) return cached;

  const response = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const matchingSheet = response.data.sheets?.find(
    (sheet) => sheet.properties?.title === tabName,
  );

  const sheetId = matchingSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab not found in spreadsheet: "${tabName}"`);
  }

  tabSheetIdCache.set(tabName, sheetId);
  return sheetId;
}

// 1 → "A", 26 → "Z", 27 → "AA", 702 → "ZZ", 703 → "AAA"
export function columnLetterFor(columnNumber: number): string {
  if (columnNumber < 1)
    throw new Error(`columnLetterFor: expected >= 1, got ${columnNumber}`);

  let letters = "";
  let remaining = columnNumber;
  while (remaining > 0) {
    const zeroIndexed = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + zeroIndexed) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}
