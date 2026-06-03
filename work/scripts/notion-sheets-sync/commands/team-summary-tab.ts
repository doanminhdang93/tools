import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { parseTab } from "../src/sheets/parser.ts";
import {
  COLUMN_INDEX,
  PO_LAYOUT_COLUMN_INDEX,
  rolesIncludePo,
} from "../src/constants.ts";

function columnLetter(zeroBasedIndex: number): string {
  let remaining = zeroBasedIndex;
  let letters = "";
  while (remaining >= 0) {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letters;
}
import { readMembers, type Member } from "../src/util/members.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TEAM_SUMMARY_TAB = "Team Summary";
const SKIP_ROLES = new Set(["pm"]);

const TITLE_ROW = 1;
const MONTH_HEADER_ROW = 2;
const SUBHEADER_ROW = 3;
const TOTAL_ROW = 4;
const FIRST_MEMBER_ROW = 5;

function rgb(hex: string) {
  const value = parseInt(hex.replace("#", ""), 16);
  return {
    red: ((value >> 16) & 0xff) / 255,
    green: ((value >> 8) & 0xff) / 255,
    blue: (value & 0xff) / 255,
  };
}

const TITLE_FILL = rgb("#1b5e20");
const MONTH_FILL = rgb("#2e7d32");
const SUBHEADER_FILL = rgb("#43a047");
const TOTAL_FILL = rgb("#a5d6a7");
const STRIPE_FILL = rgb("#f6faf4");
const WHITE_FILL = rgb("#ffffff");
const TEXT_LIGHT = rgb("#ffffff");
const TEXT_SUBTLE = rgb("#33691e");
const BORDER_STRONG = { style: "SOLID_MEDIUM" as const, color: rgb("#2e7d32") };

interface MonthRef {
  label: string;
  month: number;
  year: number;
}

async function main(): Promise<void> {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const spreadsheetId = appConfig.googleSheetsId;

  const members = (await readMembers()).filter(
    (member) => !SKIP_ROLES.has(member.role.trim().toLowerCase()),
  );
  console.log(`Loaded ${members.length} payable members.`);

  const months = await collectAllMonths(sheetsApi, spreadsheetId, members);
  console.log(`Collected ${months.length} unique months across members.`);

  const sheetId = await ensureTeamSummaryTab(sheetsApi, spreadsheetId, members.length, months.length);
  console.log(`✔ Team Summary tab ready (sheetId=${sheetId})`);

  await writeTeamSummaryContent(sheetsApi, spreadsheetId, members, months);
  console.log(`✔ wrote content (${members.length} members × ${months.length} months)`);

  await applyTeamSummaryFormatting(sheetsApi, spreadsheetId, sheetId, members.length, months.length);
  console.log(`✔ applied formatting`);

  console.log("\nAll done.");
}

async function collectAllMonths(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  members: Member[],
): Promise<MonthRef[]> {
  const labelSet = new Set<string>();
  for (const member of members) {
    try {
      const response = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `${member.tabName}!A:Z`,
      });
      const rows = (response.data.values ?? []).map((row) =>
        row.map((cell) => (cell ?? "").toString()),
      );
      const parsed = parseTab(rows);
      for (const section of parsed.sections) labelSet.add(section.monthLabel);
    } catch (cause) {
      console.warn(`  (skipping ${member.tabName}: ${(cause as Error).message})`);
    }
  }
  const months: MonthRef[] = [];
  for (const label of labelSet) {
    const [monthString, yearString] = label.split("/");
    const month = Number(monthString);
    const year = Number(yearString);
    if (!Number.isFinite(month) || !Number.isFinite(year)) continue;
    months.push({ label, month, year });
  }
  months.sort((left, right) => {
    if (left.year !== right.year) return right.year - left.year;
    return right.month - left.month;
  });
  return months;
}

async function ensureTeamSummaryTab(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  memberCount: number,
  monthCount: number,
): Promise<number> {
  const requiredColumns = 1 + monthCount * 2 + 1;
  const requiredRows = FIRST_MEMBER_ROW + memberCount + 5;

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existing = workbook.data.sheets?.find(
    (sheet) => sheet.properties?.title === TEAM_SUMMARY_TAB,
  );
  if (existing?.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
    const sheetId = existing.properties.sheetId;
    const currentColumns = existing.properties.gridProperties?.columnCount ?? 10;
    const currentRows = existing.properties.gridProperties?.rowCount ?? 100;
    const requests: sheets_v4.Schema$Request[] = [];
    if (currentColumns < requiredColumns) {
      requests.push({
        appendDimension: { sheetId, dimension: "COLUMNS", length: requiredColumns - currentColumns },
      });
    }
    if (currentRows < requiredRows) {
      requests.push({
        appendDimension: { sheetId, dimension: "ROWS", length: requiredRows - currentRows },
      });
    }
    requests.push({
      unmergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: requiredRows,
          startColumnIndex: 0,
          endColumnIndex: requiredColumns,
        },
      },
    });
    if (requests.length > 0) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }
    await sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: `${TEAM_SUMMARY_TAB}!A:ZZ`,
    });
    return sheetId;
  }

  const response = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: TEAM_SUMMARY_TAB,
            gridProperties: { rowCount: requiredRows, columnCount: requiredColumns, frozenRowCount: SUBHEADER_ROW, frozenColumnCount: 1 },
            index: 1,
          },
        },
      }],
    },
  });
  const addedSheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (addedSheetId === undefined || addedSheetId === null) {
    throw new Error(`Failed to create "${TEAM_SUMMARY_TAB}" tab`);
  }
  return addedSheetId;
}

async function writeTeamSummaryContent(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  members: Member[],
  months: MonthRef[],
): Promise<void> {
  const oldPointCol = columnLetter(COLUMN_INDEX.point);
  const oldMoneyCol = columnLetter(COLUMN_INDEX.money);
  const poBaCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.baPoint);
  const poTestCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.testPoint);
  const poMoneyCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.money);

  const lastMemberRow = FIRST_MEMBER_ROW + members.length - 1;

  const titleRow = ["Team Monthly Summary"];
  const monthHeaderRow: string[] = [""];
  const subHeaderRow: string[] = ["Member"];
  for (const month of months) {
    monthHeaderRow.push(`=DATE(${month.year},${month.month},1)`, "");
    subHeaderRow.push("Point", "Money");
  }

  const totalRow: string[] = ["TOTAL"];
  for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
    const pointCol = columnLetter(1 + monthIndex * 2);
    const moneyCol = columnLetter(1 + monthIndex * 2 + 1);
    totalRow.push(
      `=SUM(${pointCol}${FIRST_MEMBER_ROW}:${pointCol}${lastMemberRow})`,
      `=SUM(${moneyCol}${FIRST_MEMBER_ROW}:${moneyCol}${lastMemberRow})`,
    );
  }

  const memberRows: string[][] = members.map((member) => {
    const isPo = rolesIncludePo(member.role);
    const tabRef = `'${member.tabName}'`;
    const row: string[] = [member.tabName];
    for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
      const monthColLetter = columnLetter(1 + monthIndex * 2);
      const monthCellRef = `${monthColLetter}$${MONTH_HEADER_ROW}`;
      const pointFormula = isPo
        ? `=SUMIF(${tabRef}!A:A,${monthCellRef},${tabRef}!${poBaCol}:${poBaCol})+SUMIF(${tabRef}!A:A,${monthCellRef},${tabRef}!${poTestCol}:${poTestCol})`
        : `=SUMIF(${tabRef}!A:A,${monthCellRef},${tabRef}!${oldPointCol}:${oldPointCol})`;
      const moneyFormula = isPo
        ? `=SUMIF(${tabRef}!A:A,${monthCellRef},${tabRef}!${poMoneyCol}:${poMoneyCol})`
        : `=SUMIF(${tabRef}!A:A,${monthCellRef},${tabRef}!${oldMoneyCol}:${oldMoneyCol})`;
      row.push(pointFormula, moneyFormula);
    }
    return row;
  });

  const lastColLetter = columnLetter(1 + months.length * 2 - 1);
  const updates: sheets_v4.Schema$ValueRange[] = [
    { range: `${TEAM_SUMMARY_TAB}!A${TITLE_ROW}`, values: [titleRow] },
    { range: `${TEAM_SUMMARY_TAB}!A${MONTH_HEADER_ROW}:${lastColLetter}${MONTH_HEADER_ROW}`, values: [monthHeaderRow] },
    { range: `${TEAM_SUMMARY_TAB}!A${SUBHEADER_ROW}:${lastColLetter}${SUBHEADER_ROW}`, values: [subHeaderRow] },
    { range: `${TEAM_SUMMARY_TAB}!A${TOTAL_ROW}:${lastColLetter}${TOTAL_ROW}`, values: [totalRow] },
    { range: `${TEAM_SUMMARY_TAB}!A${FIRST_MEMBER_ROW}:${lastColLetter}${lastMemberRow}`, values: memberRows },
  ];

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates },
  });
}

async function applyTeamSummaryFormatting(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  memberCount: number,
  monthCount: number,
): Promise<void> {
  const lastColExclusive = 1 + monthCount * 2;
  const lastMemberRowExclusive = FIRST_MEMBER_ROW + memberCount;
  const requests: sheets_v4.Schema$Request[] = [];

  requests.push({ clearBasicFilter: { sheetId } });

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  requests.push({
    mergeCells: {
      range: gridRange(sheetId, TITLE_ROW, TITLE_ROW + 1, 0, lastColExclusive),
      mergeType: "MERGE_ALL",
    },
  });
  requests.push(styleRange(sheetId, TITLE_ROW, TITLE_ROW + 1, 0, lastColExclusive, {
    backgroundColor: TITLE_FILL,
    textFormat: { bold: true, fontSize: 16, foregroundColor: TEXT_LIGHT, fontFamily: "Google Sans" },
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
  }));

  for (let monthIndex = 0; monthIndex < monthCount; monthIndex++) {
    const startCol = 1 + monthIndex * 2;
    requests.push({
      mergeCells: {
        range: gridRange(sheetId, MONTH_HEADER_ROW, MONTH_HEADER_ROW + 1, startCol, startCol + 2),
        mergeType: "MERGE_ALL",
      },
    });
  }
  requests.push(styleRange(sheetId, MONTH_HEADER_ROW, MONTH_HEADER_ROW + 1, 1, lastColExclusive, {
    backgroundColor: MONTH_FILL,
    textFormat: { bold: true, fontSize: 12, foregroundColor: TEXT_LIGHT },
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
    numberFormat: { type: "DATE", pattern: "m/yyyy" },
  }));

  requests.push(styleRange(sheetId, MONTH_HEADER_ROW, MONTH_HEADER_ROW + 1, 0, 1, {
    backgroundColor: TITLE_FILL,
  }));

  requests.push(styleRange(sheetId, SUBHEADER_ROW, SUBHEADER_ROW + 1, 0, lastColExclusive, {
    backgroundColor: SUBHEADER_FILL,
    textFormat: { bold: true, fontSize: 11, foregroundColor: TEXT_LIGHT },
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
  }));

  requests.push(styleRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, 0, lastColExclusive, {
    backgroundColor: TOTAL_FILL,
    textFormat: { bold: true, fontSize: 12, foregroundColor: TEXT_SUBTLE },
    horizontalAlignment: "RIGHT",
    verticalAlignment: "MIDDLE",
    padding: { right: 8 },
  }));
  requests.push(styleRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, 0, 1, {
    horizontalAlignment: "CENTER",
  }));

  requests.push(styleRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, 0, 1, {
    backgroundColor: WHITE_FILL,
    textFormat: { bold: true, fontSize: 11, foregroundColor: TEXT_SUBTLE },
    horizontalAlignment: "LEFT",
    verticalAlignment: "MIDDLE",
    padding: { left: 8 },
  }));
  requests.push(styleRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, 1, lastColExclusive, {
    backgroundColor: WHITE_FILL,
    textFormat: { fontSize: 11 },
    horizontalAlignment: "RIGHT",
    verticalAlignment: "MIDDLE",
    padding: { right: 8 },
  }));

  for (let monthIndex = 0; monthIndex < monthCount; monthIndex++) {
    const pointCol = 1 + monthIndex * 2;
    const moneyCol = pointCol + 1;
    requests.push(numberFormatRange(sheetId, TOTAL_ROW, lastMemberRowExclusive, pointCol, pointCol + 1, "#,##0"));
    requests.push(numberFormatRange(sheetId, TOTAL_ROW, lastMemberRowExclusive, moneyCol, moneyCol + 1, `#,##0" ₫"`));
  }

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [gridRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, 0, lastColExclusive)],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=AND($A${FIRST_MEMBER_ROW}<>"",ISEVEN(ROW()))` }],
          },
          format: { backgroundColor: STRIPE_FILL },
        },
      },
      index: 0,
    },
  });

  requests.push({
    updateBorders: {
      range: gridRange(sheetId, SUBHEADER_ROW, SUBHEADER_ROW + 1, 0, lastColExclusive),
      bottom: BORDER_STRONG,
    },
  });
  requests.push({
    updateBorders: {
      range: gridRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, 0, lastColExclusive),
      top: BORDER_STRONG,
      bottom: BORDER_STRONG,
    },
  });

  requests.push(setColumnWidth(sheetId, 0, 110));
  for (let monthIndex = 0; monthIndex < monthCount; monthIndex++) {
    const pointCol = 1 + monthIndex * 2;
    requests.push(setColumnWidth(sheetId, pointCol, 80));
    requests.push(setColumnWidth(sheetId, pointCol + 1, 110));
  }

  requests.push(setRowHeight(sheetId, TITLE_ROW - 1, 44));
  requests.push(setRowHeight(sheetId, MONTH_HEADER_ROW - 1, 32));
  requests.push(setRowHeight(sheetId, SUBHEADER_ROW - 1, 28));
  requests.push(setRowHeight(sheetId, TOTAL_ROW - 1, 32));

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { hideGridlines: true, frozenRowCount: SUBHEADER_ROW, frozenColumnCount: 0 } },
      fields: "gridProperties.hideGridlines,gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

function styleRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowExclusiveOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
  format: sheets_v4.Schema$CellFormat,
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: firstRowOneBased - 1,
        endRowIndex: lastRowExclusiveOneBased - 1,
        startColumnIndex: startColumnZeroBased,
        endColumnIndex: endColumnZeroBased,
      },
      cell: { userEnteredFormat: format },
      fields: buildFormatFields(format),
    },
  };
}

function buildFormatFields(format: sheets_v4.Schema$CellFormat): string {
  const parts: string[] = [];
  if (format.backgroundColor) parts.push("backgroundColor");
  if (format.textFormat) parts.push("textFormat");
  if (format.horizontalAlignment) parts.push("horizontalAlignment");
  if (format.verticalAlignment) parts.push("verticalAlignment");
  if (format.padding) parts.push("padding");
  if (format.numberFormat) parts.push("numberFormat");
  return parts.map((part) => `userEnteredFormat.${part}`).join(",");
}

function numberFormatRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowExclusiveOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
  pattern: string,
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: firstRowOneBased - 1,
        endRowIndex: lastRowExclusiveOneBased - 1,
        startColumnIndex: startColumnZeroBased,
        endColumnIndex: endColumnZeroBased,
      },
      cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern } } },
      fields: "userEnteredFormat.numberFormat",
    },
  };
}

function setColumnWidth(sheetId: number, columnZeroBased: number, pixelSize: number): sheets_v4.Schema$Request {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: columnZeroBased, endIndex: columnZeroBased + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

function setRowHeight(sheetId: number, rowZeroBased: number, pixelSize: number): sheets_v4.Schema$Request {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: rowZeroBased, endIndex: rowZeroBased + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

function gridRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowExclusiveOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
): sheets_v4.Schema$GridRange {
  return {
    sheetId,
    startRowIndex: firstRowOneBased - 1,
    endRowIndex: lastRowExclusiveOneBased - 1,
    startColumnIndex: startColumnZeroBased,
    endColumnIndex: endColumnZeroBased,
  };
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
