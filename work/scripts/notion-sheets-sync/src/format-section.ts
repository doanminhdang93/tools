import type { sheets_v4 } from "googleapis";
import { COLUMN_INDEX, MONTH_HEADER_PATTERN } from "./constants.ts";

const SOURCE_TAB = "DangDM";
const SOURCE_VALIDATION_ROW = 336;
const SEPARATOR_FILL = { red: 217 / 255, green: 234 / 255, blue: 211 / 255 };

export interface FormatSectionArgs {
  sheetsApi: sheets_v4.Sheets;
  spreadsheetId: string;
  tabName: string;
  monthLabel: string;
}

export async function formatSection(args: FormatSectionArgs): Promise<void> {
  const { sheetsApi, spreadsheetId, tabName, monthLabel } = args;
  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const tabSheet = workbook.data.sheets?.find((sheet) => sheet.properties?.title === tabName);
  const sheetId = tabSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab "${tabName}" not found`);
  }
  const sourceSheetId = workbook.data.sheets?.find((sheet) => sheet.properties?.title === SOURCE_TAB)?.properties?.sheetId;
  if (sourceSheetId === undefined || sourceSheetId === null) {
    throw new Error(`Source tab "${SOURCE_TAB}" not found`);
  }

  await compactStaleRowsAfterSection(sheetsApi, spreadsheetId, sheetId, tabName, monthLabel);

  const refreshedWorkbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const refreshedTabSheet = refreshedWorkbook.data.sheets?.find((sheet) => sheet.properties?.title === tabName);
  const rowCount = refreshedTabSheet?.properties?.gridProperties?.rowCount ?? 1000;

  const valuesResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:E`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = valuesResp.data.values ?? [];

  let headerRowZeroBased = -1;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i]?.[0] ?? "").toString().trim() === monthLabel) {
      headerRowZeroBased = i;
      break;
    }
  }
  if (headerRowZeroBased < 0) {
    console.log(`[${tabName}] format skipped — section "${monthLabel}" not found`);
    return;
  }

  let lastTaskRowZeroBased = headerRowZeroBased;
  for (let i = headerRowZeroBased + 1; i < rows.length; i++) {
    const colA = (rows[i]?.[0] ?? "").toString().trim();
    const colB = (rows[i]?.[1] ?? "").toString().trim();
    if (MONTH_HEADER_PATTERN.test(colA) && colA !== monthLabel) break;
    if (!colA && !colB) break;
    if (!colB) break;
    lastTaskRowZeroBased = i;
  }
  console.log(`[${tabName}] formatting "${monthLabel}": header row ${headerRowZeroBased + 1}, tasks ${headerRowZeroBased + 2}-${lastTaskRowZeroBased + 1}`);

  const closingSeparatorPreview = lastTaskRowZeroBased + 1;
  if (closingSeparatorPreview >= rowCount) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: "ROWS", length: 20 } }],
      },
    });
  }

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
    console.log(`  inserted opening separator row above`);
  }
  const separatorAboveZeroBased = headerRowZeroBased - 1;

  const closingSeparatorZeroBased = lastTaskRowZeroBased + 1;
  if (closingSeparatorZeroBased >= rowCount || !isRowEmpty(rows, closingSeparatorZeroBased)) {
    requests.push({
      insertDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: closingSeparatorZeroBased, endIndex: closingSeparatorZeroBased + 1 },
        inheritFromBefore: false,
      },
    });
    console.log(`  inserted closing separator row below`);
  }

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: headerRowZeroBased, endRowIndex: lastTaskRowZeroBased + 1 },
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

  if (lastTaskRowZeroBased > headerRowZeroBased) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: headerRowZeroBased + 1,
          endRowIndex: lastTaskRowZeroBased + 1,
          startColumnIndex: COLUMN_INDEX.month,
          endColumnIndex: COLUMN_INDEX.month + 1,
        },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });
  }

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
        range: { sheetId, startRowIndex: sepRowZeroBased, endRowIndex: sepRowZeroBased + 1 },
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
      cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
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

  const isSourceTab = tabName === SOURCE_TAB;
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
    await reportNewValidationValues(sheetsApi, spreadsheetId, rows, taskFirstRowZeroBased, taskLastRowZeroBased);
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
  console.log(`[${tabName}] ✔ formatted section "${monthLabel}"`);
}

async function compactStaleRowsAfterSection(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  tabName: string,
  monthLabel: string,
): Promise<void> {
  const valuesResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:B`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = valuesResp.data.values ?? [];
  let headerRowZeroBased = -1;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i]?.[0] ?? "").toString().trim() === monthLabel) { headerRowZeroBased = i; break; }
  }
  if (headerRowZeroBased < 0) return;
  let lastTaskRowZeroBased = headerRowZeroBased;
  for (let i = headerRowZeroBased + 1; i < rows.length; i++) {
    const colA = (rows[i]?.[0] ?? "").toString().trim();
    const colB = (rows[i]?.[1] ?? "").toString().trim();
    if (MONTH_HEADER_PATTERN.test(colA) && colA !== monthLabel) break;
    if (!colA && !colB) break;
    if (!colB) break;
    lastTaskRowZeroBased = i;
  }

  const buffer = 50;
  const startRow = lastTaskRowZeroBased + 1;
  const tabMeta = await sheetsApi.spreadsheets.get({ spreadsheetId, ranges: [`${tabName}!A1`] });
  const tabRowCount = tabMeta.data.sheets?.[0]?.properties?.gridProperties?.rowCount ?? 1000;
  const endRow = Math.min(startRow + buffer, tabRowCount);
  if (endRow <= startRow) return;
  const gridResp = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    ranges: [`${tabName}!A${startRow + 1}:A${endRow}`],
    includeGridData: true,
  });
  const rowData = gridResp.data.sheets?.[0]?.data?.[0]?.rowData ?? [];

  let nextSectionRow = -1;
  let lastMintRow = -1;
  for (let i = 0; i < rowData.length; i++) {
    const cellA = rowData[i]?.values?.[0];
    const colAValue = (cellA?.formattedValue ?? "").toString().trim();
    if (colAValue) { nextSectionRow = startRow + i; break; }
    const fill = cellA?.effectiveFormat?.backgroundColor;
    if (fill && isMintFill(fill)) lastMintRow = startRow + i;
  }

  let endDeleteExclusive: number;
  if (nextSectionRow > startRow + 1) {
    endDeleteExclusive = nextSectionRow;
  } else if (nextSectionRow < 0 && lastMintRow >= startRow) {
    endDeleteExclusive = lastMintRow + 1;
  } else {
    return;
  }

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: startRow, endIndex: endDeleteExclusive },
        },
      }],
    },
  });
  console.log(`[${tabName}] compacted ${endDeleteExclusive - startRow} stale row(s) below "${monthLabel}"`);
}

function isMintFill(fill: sheets_v4.Schema$Color): boolean {
  const red = fill.red ?? 1;
  const green = fill.green ?? 1;
  const blue = fill.blue ?? 1;
  return Math.abs(red - 217 / 255) < 0.05 && Math.abs(green - 234 / 255) < 0.05 && Math.abs(blue - 211 / 255) < 0.05;
}

function isRowEmpty(rows: string[][], rowZeroBased: number): boolean {
  if (rowZeroBased >= rows.length) return true;
  const colA = (rows[rowZeroBased]?.[0] ?? "").toString().trim();
  const colB = (rows[rowZeroBased]?.[1] ?? "").toString().trim();
  return colA === "" && colB === "";
}

async function reportNewValidationValues(
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
