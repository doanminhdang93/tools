import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { parseTab } from "../src/sheets/parser.ts";
import {
  POINT_VALUE_VND,
  SHEET_COLUMN_COUNT,
  COLUMN_INDEX,
  columnLetter,
} from "../src/constants.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const SOURCE_SPREADSHEET_ID = "1A2LA-7IQAvegd2lzWf2IFCJ4G2_haghnWwTA2wyMxIg";
const SOURCE_TAB = "Dev team - Board";
const MIN_MONTH_SERIAL = 2023 * 12 + 10; // October 2023
const TEAM_TABS = [
  "DangDM",
  "ChienNH",
  "CuongLT",
  "HieuNM",
  "HuyKT",
  "NhatNT",
  "HieuNT",
  "BachNH",
  "DuongNT",
];

interface SourceRecord {
  monthLabel: string;
  monthSerial: number;
  member: string;
  point: number;
}

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });

  const sourceRows = await readSourceRows(sheetsApi);
  const sourceByMember = groupSourceByMember(sourceRows);
  logSourceSummary(sourceByMember);

  for (const memberTab of TEAM_TABS) {
    await backfillMember(sheetsApi, appConfig.googleSheetsId, memberTab, sourceByMember);
  }
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
    const member = (row?.[1] ?? "").toString().trim();
    if (!member) continue;
    const pointRaw = (row?.[2] ?? "").toString().trim().replace(/,/g, "");
    const point = Number(pointRaw);
    if (!Number.isFinite(point) || point <= 0) continue;
    const monthSerial = monthSerialFromLabel(monthLabel);
    if (monthSerial < MIN_MONTH_SERIAL) continue;
    records.push({ monthLabel, monthSerial, member, point });
  }
  return records;
}

function groupSourceByMember(records: SourceRecord[]): Map<string, Map<string, number>> {
  const byMember = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (!TEAM_TABS.includes(record.member)) continue;
    let byMonth = byMember.get(record.member);
    if (!byMonth) {
      byMonth = new Map();
      byMember.set(record.member, byMonth);
    }
    byMonth.set(record.monthLabel, record.point);
  }
  return byMember;
}

function logSourceSummary(byMember: Map<string, Map<string, number>>): void {
  console.log("Source records per team member:");
  for (const memberTab of TEAM_TABS) {
    const months = byMember.get(memberTab);
    const count = months?.size ?? 0;
    console.log(`  ${memberTab}: ${count} month(s)`);
  }
}

async function backfillMember(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  memberTab: string,
  sourceByMember: Map<string, Map<string, number>>,
): Promise<void> {
  const sourceMonths = sourceByMember.get(memberTab);
  if (!sourceMonths || sourceMonths.size === 0) {
    console.log(`[${memberTab}] skip — no source data`);
    return;
  }

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const tabSheet = workbook.data.sheets?.find((sheet) => sheet.properties?.title === memberTab);
  const sheetId = tabSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    console.log(`[${memberTab}] skip — tab not found`);
    return;
  }

  const valuesResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${memberTab}!A:J`,
  });
  const existingRows = (valuesResp.data.values ?? []).map((row) =>
    row.map((cell) => (cell ?? "").toString()),
  );
  const parsed = parseTab(existingRows);
  const existingMonths = new Set(parsed.sections.map((section) => section.monthLabel));

  const missing: Array<{ monthLabel: string; point: number }> = [];
  for (const [monthLabel, point] of sourceMonths) {
    if (!existingMonths.has(monthLabel)) {
      missing.push({ monthLabel, point });
    }
  }
  if (missing.length === 0) {
    console.log(`[${memberTab}] nothing to add — all ${sourceMonths.size} source months already present`);
    return;
  }
  missing.sort((left, right) => monthSerialFromLabel(left.monthLabel) - monthSerialFromLabel(right.monthLabel));
  console.log(
    `[${memberTab}] adding ${missing.length} placeholder(s): ${missing.map((m) => `${m.monthLabel}=${m.point}`).join(", ")}`,
  );

  const firstExistingSectionHeaderRow = parsed.sections[0]?.headerRowIndex ?? existingRows.length + 2;
  const insertAt = firstExistingSectionHeaderRow;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: insertAt - 1,
              endIndex: insertAt - 1 + missing.length,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  const pointCol = columnLetter(COLUMN_INDEX.point);
  const lastCol = columnLetter(SHEET_COLUMN_COUNT - 1);
  const valueUpdates: sheets_v4.Schema$ValueRange[] = [];
  for (let index = 0; index < missing.length; index++) {
    const { monthLabel, point } = missing[index];
    const rowOneBased = insertAt + index;
    const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
    row[COLUMN_INDEX.month] = monthLabel;
    row[COLUMN_INDEX.point] = String(point);
    row[COLUMN_INDEX.money] = `=${pointCol}${rowOneBased}*${POINT_VALUE_VND}`;
    valueUpdates.push({
      range: `${memberTab}!A${rowOneBased}:${lastCol}${rowOneBased}`,
      values: [row],
    });
  }
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: valueUpdates,
    },
  });
  console.log(`[${memberTab}] wrote ${valueUpdates.length} placeholder row(s)`);
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
  const n = Number(trimmed);
  if (Number.isFinite(n) && n >= 1 && n <= 200) {
    const year = 2023 + Math.floor((n - 1) / 12);
    const month = ((n - 1) % 12) + 1;
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
