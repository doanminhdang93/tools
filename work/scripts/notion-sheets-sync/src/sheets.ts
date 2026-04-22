import { google, sheets_v4 } from "googleapis";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RowUpdate {
  rowIndex: number;
  values: string[];
}

export interface SheetsClient {
  readExistingRows(tabName: string): Promise<Map<string, number>>;
  ensureHeaders(tabName: string, visibleHeaders: string[]): Promise<void>;
  batchUpdateRows(tabName: string, updates: RowUpdate[]): Promise<void>;
  appendRows(tabName: string, rows: string[][]): Promise<void>;
}

const SHEETS_API_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const HIDDEN_ID_HEADER = "_notion_id";
const HEADER_ROW_COUNT = 1;
const FIRST_DATA_ROW = HEADER_ROW_COUNT + 1;

export function createSheetsClient(
  serviceAccountKeyFile: string,
  spreadsheetId: string,
): SheetsClient {
  const sheetsApi = buildSheetsApi(serviceAccountKeyFile);
  return {
    readExistingRows: (tabName) => readExistingRows(sheetsApi, spreadsheetId, tabName),
    ensureHeaders: (tabName, visibleHeaders) =>
      ensureHeaders(sheetsApi, spreadsheetId, tabName, visibleHeaders),
    batchUpdateRows: (tabName, updates) =>
      batchUpdateRows(sheetsApi, spreadsheetId, tabName, updates),
    appendRows: (tabName, rows) => appendRows(sheetsApi, spreadsheetId, tabName, rows),
  };
}

function buildSheetsApi(serviceAccountKeyFile: string): sheets_v4.Sheets {
  const absoluteKeyPath = resolve(serviceAccountKeyFile);
  const credentials = JSON.parse(readFileSync(absoluteKeyPath, "utf8"));
  const googleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [SHEETS_API_SCOPE],
  });
  return google.sheets({ version: "v4", auth: googleAuth });
}

async function readExistingRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<Map<string, number>> {
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:A`,
  });

  const rowIdIndex = new Map<string, number>();
  const columnValues = response.data.values ?? [];

  for (let rowOffset = HEADER_ROW_COUNT; rowOffset < columnValues.length; rowOffset++) {
    const notionPageId = columnValues[rowOffset]?.[0];
    if (typeof notionPageId !== "string" || notionPageId.length === 0) continue;
    rowIdIndex.set(notionPageId, rowOffset + 1);
  }

  return rowIdIndex;
}

async function ensureHeaders(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  visibleHeaders: string[],
): Promise<void> {
  const fullHeaderRow = [HIDDEN_ID_HEADER, ...visibleHeaders];
  const lastColumnLetter = columnLetterFor(fullHeaderRow.length);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:${lastColumnLetter}1`,
    valueInputOption: "RAW",
    requestBody: { values: [fullHeaderRow] },
  });
}

async function batchUpdateRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  updates: RowUpdate[],
): Promise<void> {
  if (updates.length === 0) return;

  const batchPayload = updates.map((update) => {
    const lastColumnLetter = columnLetterFor(update.values.length);
    return {
      range: `${tabName}!A${update.rowIndex}:${lastColumnLetter}${update.rowIndex}`,
      values: [update.values],
    };
  });

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: batchPayload },
  });
}

async function appendRows(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A${FIRST_DATA_ROW}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
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
