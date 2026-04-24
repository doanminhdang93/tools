import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { loadConfig } from "../src/config.ts";
import {
  POINT_VALUE_VND,
  SHEET_COLUMN_COUNT,
  SHEET_COLUMN_HEADERS,
  COLUMN_INDEX,
  columnLetter,
} from "../src/constants.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const SOURCE_SPREADSHEET_ID = "1A2LA-7IQAvegd2lzWf2IFCJ4G2_haghnWwTA2wyMxIg";
const SOURCE_TAB = "Dev team - Board";
const MIN_MONTH_SERIAL = 2023 * 12 + 10;
const MAX_MONTH_SERIAL = 2026 * 12 + 3;

const SOURCE_TO_TAB: Record<string, string> = {
  ChienNH: "ChienNH",
  CuongLT: "CuongLT",
  HieuNM: "HieuNM",
  HuyKT: "HuyKT",
  NhatNT: "NhatNT",
  HieuNT: "HieuNT",
  HieuNT1: "HieuNT",
  BachNH: "BachNH",
  DuongNT: "DuongNT",
};
const TARGET_TABS = [...new Set(Object.values(SOURCE_TO_TAB))];

interface SourceRecord {
  monthLabel: string;
  monthSerial: number;
  tabName: string;
  point: number;
}

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const spreadsheetId = appConfig.googleSheetsId;

  const sourceRows = await readSourceRows(sheetsApi);
  const sourceByTab = groupSourceByTab(sourceRows);
  logSourceSummary(sourceByTab);

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(
    (workbook.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? ""),
  );

  const tabsToCreate = TARGET_TABS.filter((tab) => !existingTitles.has(tab));
  if (tabsToCreate.length > 0) {
    console.log(`\nCreating tabs: ${tabsToCreate.join(", ")}`);
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: tabsToCreate.map((title) => ({
          addSheet: { properties: { title } },
        })),
      },
    });
  } else {
    console.log("\nAll tabs already exist");
  }

  const refreshed = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const tabByName = new Map<string, number>();
  for (const sheet of refreshed.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && typeof sheetId === "number") {
      tabByName.set(title, sheetId);
    }
  }

  for (const tabName of TARGET_TABS) {
    const sheetId = tabByName.get(tabName);
    if (sheetId === undefined) {
      console.log(`[${tabName}] skip — not found`);
      continue;
    }
    const monthsMap = sourceByTab.get(tabName);
    if (!monthsMap || monthsMap.size === 0) {
      console.log(`[${tabName}] skip — no source data`);
      continue;
    }
    const entries = [...monthsMap.entries()].sort(
      (left, right) => monthSerialFromLabel(left[0]) - monthSerialFromLabel(right[0]),
    );
    console.log(`[${tabName}] populating ${entries.length} placeholder row(s)`);
    await populateTab(sheetsApi, spreadsheetId, tabName, sheetId, entries);
    console.log(`[${tabName}] done`);
  }
}

async function populateTab(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  sheetId: number,
  entries: Array<[string, number]>,
): Promise<void> {
  const pointCol = columnLetter(COLUMN_INDEX.point);
  const headerRow = [...SHEET_COLUMN_HEADERS];
  const placeholderRows = entries.map(([monthLabel, point], index) => {
    const rowOneBased = index + 2;
    const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
    row[COLUMN_INDEX.month] = monthLabel;
    row[COLUMN_INDEX.point] = String(point);
    row[COLUMN_INDEX.money] = `=${pointCol}${rowOneBased}*${POINT_VALUE_VND}`;
    return row;
  });

  const lastRowOneBased = 1 + placeholderRows.length;
  const lastCol = columnLetter(SHEET_COLUMN_COUNT - 1);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:${lastCol}${lastRowOneBased}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headerRow, ...placeholderRows] },
  });

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: SHEET_COLUMN_COUNT,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
          },
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: lastRowOneBased,
              startColumnIndex: COLUMN_INDEX.point,
              endColumnIndex: COLUMN_INDEX.money + 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: "NUMBER", pattern: "#,##0" },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: lastRowOneBased,
              startColumnIndex: COLUMN_INDEX.month,
              endColumnIndex: COLUMN_INDEX.month + 1,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER",
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat(horizontalAlignment,textFormat)",
          },
        },
      ],
    },
  });
}

async function readSourceRows(sheetsApi: sheets_v4.Sheets): Promise<SourceRecord[]> {
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SOURCE_SPREADSHEET_ID,
    range: `${SOURCE_TAB}!A1:I2000`,
  });
  const rows = response.data.values ?? [];
  const records: SourceRecord[] = [];
  for (const row of rows) {
    const monthLabel = parseMonthLabel((row?.[0] ?? "").toString().trim());
    if (!monthLabel) continue;
    const sourceMember = (row?.[1] ?? "").toString().trim();
    const tabName = SOURCE_TO_TAB[sourceMember];
    if (!tabName) continue;
    const pointRaw = (row?.[2] ?? "").toString().trim().replace(/,/g, "");
    const point = Number(pointRaw);
    if (!Number.isFinite(point) || point <= 0) continue;
    const monthSerial = monthSerialFromLabel(monthLabel);
    if (monthSerial < MIN_MONTH_SERIAL || monthSerial > MAX_MONTH_SERIAL) continue;
    records.push({ monthLabel, monthSerial, tabName, point });
  }
  return records;
}

function groupSourceByTab(records: SourceRecord[]): Map<string, Map<string, number>> {
  const byTab = new Map<string, Map<string, number>>();
  for (const record of records) {
    let byMonth = byTab.get(record.tabName);
    if (!byMonth) {
      byMonth = new Map();
      byTab.set(record.tabName, byMonth);
    }
    byMonth.set(record.monthLabel, record.point);
  }
  return byTab;
}

function logSourceSummary(byTab: Map<string, Map<string, number>>): void {
  console.log("Source months per target tab (10/2023–3/2026):");
  for (const tabName of TARGET_TABS) {
    const months = byTab.get(tabName);
    const count = months?.size ?? 0;
    console.log(`  ${tabName}: ${count} month(s)`);
  }
}

function parseMonthLabel(rawCell: string): string {
  const trimmed = rawCell.trim();
  if (!trimmed) return "";
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    let year = Number(slashMatch[2]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return "";
    return `${month}/${year}`;
  }
  const integer = Number(trimmed);
  if (Number.isFinite(integer) && integer >= 1 && integer <= 200) {
    const year = 2023 + Math.floor((integer - 1) / 12);
    const month = ((integer - 1) % 12) + 1;
    return `${month}/${year}`;
  }
  return "";
}

function monthSerialFromLabel(label: string): number {
  const [month, year] = label.split("/").map(Number);
  return year * 12 + month;
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
