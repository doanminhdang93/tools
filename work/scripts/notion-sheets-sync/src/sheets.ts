import { google, sheets_v4 } from "googleapis";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SheetsClient {
  readTabValues(tabName: string): Promise<string[][]>;
  writeRange(tabName: string, startRow: number, rows: string[][]): Promise<void>;
  clearRows(tabName: string, startRow: number, endRow: number): Promise<void>;
}

const SHEETS_API_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function createSheetsClient(
  serviceAccountKeyFile: string,
  spreadsheetId: string,
): SheetsClient {
  const sheetsApi = buildSheetsApi(serviceAccountKeyFile);
  return {
    readTabValues: (tabName) => readTabValues(sheetsApi, spreadsheetId, tabName),
    writeRange: (tabName, startRow, rows) =>
      writeRange(sheetsApi, spreadsheetId, tabName, startRow, rows),
    clearRows: (tabName, startRow, endRow) =>
      clearRows(sheetsApi, spreadsheetId, tabName, startRow, endRow),
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
