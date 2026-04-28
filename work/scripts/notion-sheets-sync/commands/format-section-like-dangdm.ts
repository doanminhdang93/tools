import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { COLUMN_INDEX } from "../src/constants.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TAB = process.argv[2];
const MONTH = process.argv[3] ?? "3/2026";
const SOURCE_TAB = "DangDM";
const SOURCE_VALIDATION_ROW = 336;
const SEPARATOR_FILL = { red: 217 / 255, green: 234 / 255, blue: 211 / 255 };

if (!TAB) {
  console.error("Usage: tsx commands/format-section-like-dangdm.ts <Tab> [Month=3/2026]");
  process.exit(1);
}

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const spreadsheetId = appConfig.googleSheetsId;

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const tabSheet = workbook.data.sheets?.find((sheet) => sheet.properties?.title === TAB);
  const sheetId = tabSheet?.properties?.sheetId;
  const rowCount = tabSheet?.properties?.gridProperties?.rowCount ?? 1000;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab "${TAB}" not found`);
  }
  const sourceSheetId = workbook.data.sheets?.find(
    (sheet) => sheet.properties?.title === SOURCE_TAB,
  )?.properties?.sheetId;
  if (sourceSheetId === undefined || sourceSheetId === null) {
    throw new Error(`Source tab "${SOURCE_TAB}" not found`);
  }

  const valuesResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A:E`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = valuesResp.data.values ?? [];

  let headerRowZeroBased = -1;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i]?.[0] ?? "").toString().trim() === MONTH) {
      headerRowZeroBased = i;
      break;
    }
  }
  if (headerRowZeroBased < 0) {
    throw new Error(`Section "${MONTH}" not found in ${TAB}`);
  }

  let lastTaskRowZeroBased = headerRowZeroBased;
  for (let i = headerRowZeroBased + 1; i < rows.length; i++) {
    const colA = (rows[i]?.[0] ?? "").toString().trim();
    const colB = (rows[i]?.[1] ?? "").toString().trim();
    if (colA) break;
    if (!colB) break;
    lastTaskRowZeroBased = i;
  }
  if (lastTaskRowZeroBased === headerRowZeroBased) {
    console.log(`[${TAB}] WARN — section "${MONTH}" has no task rows; formatting header anyway`);
  }
  console.log(
    `[${TAB}] section "${MONTH}": header row ${headerRowZeroBased + 1}, tasks ${headerRowZeroBased + 2}-${lastTaskRowZeroBased + 1}`,
  );

  const requests: sheets_v4.Schema$Request[] = [];

  const aboveRowZeroBased = headerRowZeroBased - 1;
  if (aboveRowZeroBased < 0 || !isRowEmpty(rows, aboveRowZeroBased)) {
    requests.push({
      insertDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: headerRowZeroBased, endIndex: headerRowZeroBased + 1 },
        inheritFromBefore: false,
      },
    });
    headerRowZeroBased += 1;
    lastTaskRowZeroBased += 1;
    console.log(`  inserted separator row above`);
  }
  const separatorAboveZeroBased = headerRowZeroBased - 1;

  const closingSeparatorZeroBased = lastTaskRowZeroBased + 1;
  if (closingSeparatorZeroBased >= rowCount || !isRowEmpty(rows, closingSeparatorZeroBased)) {
    requests.push({
      insertDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: closingSeparatorZeroBased,
          endIndex: closingSeparatorZeroBased + 1,
        },
        inheritFromBefore: false,
      },
    });
    console.log(`  inserted closing separator row below`);
  }

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: headerRowZeroBased,
        endRowIndex: lastTaskRowZeroBased + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { bold: false },
          horizontalAlignment: "LEFT",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat.bold,horizontalAlignment)",
    },
  });

  for (const sepRowZeroBased of [separatorAboveZeroBased, closingSeparatorZeroBased]) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: sepRowZeroBased,
          endRowIndex: sepRowZeroBased + 1,
          startColumnIndex: COLUMN_INDEX.app,
          endColumnIndex: COLUMN_INDEX.status + 1,
        },
      },
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: sepRowZeroBased,
          endRowIndex: sepRowZeroBased + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: SEPARATOR_FILL,
            textFormat: { bold: true },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
  }

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: headerRowZeroBased,
        endRowIndex: headerRowZeroBased + 1,
        startColumnIndex: COLUMN_INDEX.month,
        endColumnIndex: COLUMN_INDEX.month + 1,
      },
      cell: {
        userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" },
      },
      fields: "userEnteredFormat(textFormat,horizontalAlignment)",
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: headerRowZeroBased,
        endRowIndex: lastTaskRowZeroBased + 1,
        startColumnIndex: COLUMN_INDEX.point,
        endColumnIndex: COLUMN_INDEX.money + 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "NUMBER", pattern: "" },
          textFormat: { bold: false },
          horizontalAlignment: "RIGHT",
        },
      },
      fields: "userEnteredFormat(numberFormat,textFormat.bold,horizontalAlignment)",
    },
  });

  const isSourceTab = TAB === SOURCE_TAB;
  if (!isSourceTab) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: headerRowZeroBased,
          endRowIndex: lastTaskRowZeroBased + 1,
          startColumnIndex: COLUMN_INDEX.app,
          endColumnIndex: COLUMN_INDEX.status + 1,
        },
      },
    });
  }

  const taskFirstRowZeroBased = headerRowZeroBased + 1;
  const taskLastRowZeroBased = lastTaskRowZeroBased;

  if (!isSourceTab && taskLastRowZeroBased >= taskFirstRowZeroBased) {
    await ensureValidationCovers(sheetsApi, spreadsheetId, rows, taskFirstRowZeroBased, taskLastRowZeroBased);
  }

  if (!isSourceTab && taskLastRowZeroBased >= taskFirstRowZeroBased) {
    requests.push({
      copyPaste: {
        source: {
          sheetId: sourceSheetId,
          startRowIndex: SOURCE_VALIDATION_ROW - 1,
          endRowIndex: SOURCE_VALIDATION_ROW,
          startColumnIndex: COLUMN_INDEX.app,
          endColumnIndex: COLUMN_INDEX.status + 1,
        },
        destination: {
          sheetId,
          startRowIndex: taskFirstRowZeroBased,
          endRowIndex: taskLastRowZeroBased + 1,
          startColumnIndex: COLUMN_INDEX.app,
          endColumnIndex: COLUMN_INDEX.status + 1,
        },
        pasteType: "PASTE_DATA_VALIDATION",
        pasteOrientation: "NORMAL",
      },
    });
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  console.log(`[${TAB}] ✔ formatted section "${MONTH}"`);
}

function isRowEmpty(rows: string[][], rowZeroBased: number): boolean {
  if (rowZeroBased >= rows.length) return true;
  const colA = (rows[rowZeroBased]?.[0] ?? "").toString().trim();
  const colB = (rows[rowZeroBased]?.[1] ?? "").toString().trim();
  return colA === "" && colB === "";
}

async function ensureValidationCovers(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  rows: string[][],
  taskFirstRowZeroBased: number,
  taskLastRowZeroBased: number,
): Promise<void> {
  const sectionApps = collectUniqueValues(rows, COLUMN_INDEX.app, taskFirstRowZeroBased, taskLastRowZeroBased);
  const sectionStatuses = collectUniqueValues(rows, COLUMN_INDEX.status, taskFirstRowZeroBased, taskLastRowZeroBased);

  const sourceResp = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    ranges: [`${SOURCE_TAB}!D${SOURCE_VALIDATION_ROW}:E${SOURCE_VALIDATION_ROW}`],
    includeGridData: true,
  });
  const sourceCells = sourceResp.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values ?? [];
  const sourceSheetId = sourceResp.data.sheets?.[0]?.properties?.sheetId;
  if (sourceSheetId === undefined || sourceSheetId === null) return;

  const appList = extractValidationValues(sourceCells[0]);
  const statusList = extractValidationValues(sourceCells[1]);

  const newApps = sectionApps.filter((value) => !appList.includes(value));
  const newStatuses = sectionStatuses.filter((value) => !statusList.includes(value));

  if (newApps.length === 0 && newStatuses.length === 0) return;
  if (newApps.length > 0) {
    console.log(`  ⚠ NEW App value(s) not in ${SOURCE_TAB}!D${SOURCE_VALIDATION_ROW}: ${newApps.join(", ")}`);
  }
  if (newStatuses.length > 0) {
    console.log(`  ⚠ NEW Status value(s) not in ${SOURCE_TAB}!E${SOURCE_VALIDATION_ROW}: ${newStatuses.join(", ")}`);
  }
  console.log(`  → Add them via the ${SOURCE_TAB} dropdown UI to keep existing chip colors intact, then re-run format.`);
  console.log(`  (Auto-extend via API would reset all chip colors since Sheets V4 cannot preserve them.)`);
}

function collectUniqueValues(
  rows: string[][],
  columnIndex: number,
  firstRowZeroBased: number,
  lastRowZeroBased: number,
): string[] {
  const unique = new Set<string>();
  for (let rowIndex = firstRowZeroBased; rowIndex <= lastRowZeroBased; rowIndex++) {
    const cellValue = (rows[rowIndex]?.[columnIndex] ?? "").toString().trim();
    if (cellValue) unique.add(cellValue);
  }
  return [...unique];
}

function extractValidationValues(cell: sheets_v4.Schema$CellData | undefined): string[] {
  const values = cell?.dataValidation?.condition?.values ?? [];
  return values.map((value) => (value.userEnteredValue ?? "").toString());
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
