import { google, sheets_v4 } from "googleapis";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHEET_COLUMN_COUNT } from "./constants.ts";

export interface SheetsClient {
  readTabValues(tabName: string): Promise<string[][]>;
  writeRange(tabName: string, startRow: number, rows: string[][]): Promise<void>;
  clearRows(tabName: string, startRow: number, endRow: number): Promise<void>;
  applySectionStyle(tabName: string, plan: SectionStylePlan): Promise<void>;
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
    readTabValues: (tabName) => readTabValues(sheetsApi, spreadsheetId, tabName),
    writeRange: (tabName, startRow, rows) =>
      writeRange(sheetsApi, spreadsheetId, tabName, startRow, rows),
    clearRows: (tabName, startRow, endRow) =>
      clearRows(sheetsApi, spreadsheetId, tabName, startRow, endRow),
    applySectionStyle: (tabName, plan) =>
      applySectionStyle(sheetsApi, spreadsheetId, tabSheetIdCache, tabName, plan),
  };
}

function buildSheetsApi(serviceAccountKeyFile: string): sheets_v4.Sheets {
  const absolutePath = resolve(serviceAccountKeyFile);
  const credentials = JSON.parse(readFileSync(absolutePath, "utf8"));
  const googleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [SHEETS_API_SCOPE],
  });
  return google.sheets({ version: "v4", auth: googleAuth });
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

async function clearRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  startRow: number,
  endRow: number,
): Promise<void> {
  if (endRow < startRow) return;
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}!A${startRow}:Z${endRow}`,
  });
}

async function applySectionStyle(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabSheetIdCache: Map<string, number>,
  tabName: string,
  plan: SectionStylePlan,
): Promise<void> {
  const sheetId = await lookupTabSheetId(sheetsApi, spreadsheetId, tabSheetIdCache, tabName);

  const requests: sheets_v4.Schema$Request[] = [
    copyFormatRequest(sheetId, plan.referenceSeparatorRow, plan.destinationSeparatorRow),
    copyFormatRequest(sheetId, plan.referenceHeaderRow, plan.destinationHeaderRow),
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

function fullWidthRowRange(sheetId: number, rowOneBased: number): sheets_v4.Schema$GridRange {
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
  if (columnNumber < 1) throw new Error(`columnLetterFor: expected >= 1, got ${columnNumber}`);

  let letters = "";
  let remaining = columnNumber;
  while (remaining > 0) {
    const zeroIndexed = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + zeroIndexed) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}
