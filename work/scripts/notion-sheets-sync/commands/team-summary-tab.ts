import "../src/util/fetch-polyfill.ts";
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
import { readMembers, type Member } from "../src/util/members.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TEAM_SUMMARY_TAB = "Team Summary";
const SKIP_ROLES = new Set(["pm"]);

const COL_MEMBER = 0;
const COL_NICKNAME = 1;
const COL_ROLE = 2;
const COL_POINT = 3;
const COL_MONEY = 4;
const COL_HIDDEN_DATE = 5;
const COL_COUNT = 6;

const TITLE_ROW = 1;
const SELECTOR_ROW = 2;
const TOTAL_ROW = 4;
const HEADER_ROW = 6;
const FIRST_MEMBER_ROW = 7;

function rgb(hex: string) {
  const value = parseInt(hex.replace("#", ""), 16);
  return {
    red: ((value >> 16) & 0xff) / 255,
    green: ((value >> 8) & 0xff) / 255,
    blue: (value & 0xff) / 255,
  };
}

const TITLE_FILL = rgb("#1b5e20");
const HEADER_FILL = rgb("#2e7d32");
const SELECTOR_LABEL_FILL = rgb("#e8f5e9");
const SELECTOR_VALUE_FILL = rgb("#ffffff");
const TOTAL_FILL = rgb("#a5d6a7");
const STRIPE_FILL = rgb("#f6faf4");
const WHITE_FILL = rgb("#ffffff");
const TEXT_LIGHT = rgb("#ffffff");
const TEXT_SUBTLE = rgb("#33691e");
const BORDER_STRONG = { style: "SOLID_MEDIUM" as const, color: rgb("#2e7d32") };
const BORDER_LIGHT = { style: "SOLID" as const, color: rgb("#c8e6c9") };

function columnLetter(zeroBasedIndex: number): string {
  let remaining = zeroBasedIndex;
  let letters = "";
  while (remaining >= 0) {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letters;
}

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
  if (months.length === 0) {
    console.warn("No months found — nothing to write.");
    return;
  }

  const { sheetId, preservedMonth } = await ensureTeamSummaryTab(
    sheetsApi,
    spreadsheetId,
    members.length,
    months,
  );
  console.log(`✔ Team Summary tab ready (sheetId=${sheetId}, preserved month=${preservedMonth ?? "none"})`);

  const selectedMonth = months.find((month) => month.label === preservedMonth) ?? months[0];

  await writeTeamSummaryContent(sheetsApi, spreadsheetId, members, selectedMonth.label);
  console.log(`✔ wrote content (${members.length} members, month=${selectedMonth.label})`);

  await applyTeamSummaryFormatting(sheetsApi, spreadsheetId, sheetId, members.length, months);
  console.log(`✔ applied formatting (${months.length} months in dropdown)`);

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
  months: MonthRef[],
): Promise<{ sheetId: number; preservedMonth: string | null }> {
  const requiredRows = FIRST_MEMBER_ROW + memberCount + 5;

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existing = workbook.data.sheets?.find(
    (sheet) => sheet.properties?.title === TEAM_SUMMARY_TAB,
  );
  if (existing?.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
    const sheetId = existing.properties.sheetId;
    const currentColumns = existing.properties.gridProperties?.columnCount ?? 4;
    const currentRows = existing.properties.gridProperties?.rowCount ?? 100;
    const requests: sheets_v4.Schema$Request[] = [];

    const selectorResponse = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${TEAM_SUMMARY_TAB}!B${SELECTOR_ROW}`,
    });
    const previousSelection = (selectorResponse.data.values?.[0]?.[0] ?? "").toString().trim();
    const preservedMonth = months.some((month) => month.label === previousSelection)
      ? previousSelection
      : null;

    requests.push({
      unmergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: currentRows,
          startColumnIndex: 0,
          endColumnIndex: currentColumns,
        },
      },
    });
    if (currentColumns > COL_COUNT) {
      requests.push({
        deleteDimension: {
          range: { sheetId, dimension: "COLUMNS", startIndex: COL_COUNT, endIndex: currentColumns },
        },
      });
    } else if (currentColumns < COL_COUNT) {
      requests.push({
        appendDimension: { sheetId, dimension: "COLUMNS", length: COL_COUNT - currentColumns },
      });
    }
    if (currentRows < requiredRows) {
      requests.push({
        appendDimension: { sheetId, dimension: "ROWS", length: requiredRows - currentRows },
      });
    }
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: Math.max(currentRows, requiredRows),
          startColumnIndex: 0,
          endColumnIndex: COL_COUNT,
        },
        cell: { userEnteredFormat: {} },
        fields: "userEnteredFormat",
      },
    });
    if (requests.length > 0) {
      await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }
    await sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: `${TEAM_SUMMARY_TAB}!A:ZZ`,
    });
    return { sheetId, preservedMonth };
  }

  const response = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: TEAM_SUMMARY_TAB,
            gridProperties: { rowCount: requiredRows, columnCount: COL_COUNT, frozenRowCount: HEADER_ROW },
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
  return { sheetId: addedSheetId, preservedMonth: null };
}

async function writeTeamSummaryContent(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  members: Member[],
  selectedMonthLabel: string,
): Promise<void> {
  const oldPointCol = columnLetter(COLUMN_INDEX.point);
  const oldReviewCol = columnLetter(COLUMN_INDEX.reviewPoint);
  const oldMoneyCol = columnLetter(COLUMN_INDEX.money);
  const poBaCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.baPoint);
  const poTestCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.testPoint);
  const poMoneyCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.money);

  const lastMemberRow = FIRST_MEMBER_ROW + members.length - 1;
  const selectorCellRef = `B${SELECTOR_ROW}`;
  const dateHelperRef = `$${columnLetter(COL_HIDDEN_DATE)}$${SELECTOR_ROW}`;
  const parsedDateFormula =
    `=IFERROR(DATE(` +
    `VALUE(MID(${selectorCellRef},FIND("/",${selectorCellRef})+1,4)),` +
    `VALUE(LEFT(${selectorCellRef},FIND("/",${selectorCellRef})-1)),` +
    `1),"")`;

  const pointColLetter = columnLetter(COL_POINT);
  const moneyColLetter = columnLetter(COL_MONEY);
  const lastDataColLetter = columnLetter(COL_MONEY);

  const updates: sheets_v4.Schema$ValueRange[] = [
    { range: `${TEAM_SUMMARY_TAB}!A${TITLE_ROW}`, values: [["Team Monthly Summary"]] },
    { range: `${TEAM_SUMMARY_TAB}!A${SELECTOR_ROW}:B${SELECTOR_ROW}`, values: [["Month", selectedMonthLabel]] },
    { range: `${TEAM_SUMMARY_TAB}!${columnLetter(COL_HIDDEN_DATE)}${SELECTOR_ROW}`, values: [[parsedDateFormula]] },
    {
      range: `${TEAM_SUMMARY_TAB}!A${TOTAL_ROW}:${lastDataColLetter}${TOTAL_ROW}`,
      values: [[
        "Total",
        "",
        "",
        `=SUM(${pointColLetter}${FIRST_MEMBER_ROW}:${pointColLetter}${lastMemberRow})`,
        `=SUM(${moneyColLetter}${FIRST_MEMBER_ROW}:${moneyColLetter}${lastMemberRow})`,
      ]],
    },
    {
      range: `${TEAM_SUMMARY_TAB}!A${HEADER_ROW}:${lastDataColLetter}${HEADER_ROW}`,
      values: [["Member", "Tab", "Role", "Point", "Money"]],
    },
  ];

  const memberRows: string[][] = members.map((member) => {
    const isPo = rolesIncludePo(member.role);
    const isSublead = member.role.trim().toLowerCase() === "sublead";
    const tabRef = `'${member.tabName}'`;
    let pointFormula: string;
    if (isPo) {
      pointFormula =
        `=SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${poBaCol}:${poBaCol})+` +
        `SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${poTestCol}:${poTestCol})`;
    } else if (isSublead) {
      pointFormula =
        `=SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${oldPointCol}:${oldPointCol})+` +
        `SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${oldReviewCol}:${oldReviewCol})`;
    } else {
      pointFormula = `=SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${oldPointCol}:${oldPointCol})`;
    }
    const moneyFormula = isPo
      ? `=SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${poMoneyCol}:${poMoneyCol})`
      : `=SUMIF(${tabRef}!A:A,${dateHelperRef},${tabRef}!${oldMoneyCol}:${oldMoneyCol})`;
    return [
      member.fullName || member.tabName,
      member.tabName,
      member.role,
      pointFormula,
      moneyFormula,
    ];
  });
  updates.push({
    range: `${TEAM_SUMMARY_TAB}!A${FIRST_MEMBER_ROW}:${lastDataColLetter}${lastMemberRow}`,
    values: memberRows,
  });

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
  months: MonthRef[],
): Promise<void> {
  const lastMemberRowExclusive = FIRST_MEMBER_ROW + memberCount;
  const requests: sheets_v4.Schema$Request[] = [];

  requests.push({ clearBasicFilter: { sheetId } });

  const workbook = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId),bandedRanges(bandedRangeId))",
  });
  const sheetMeta = workbook.data.sheets?.find((sheet) => sheet.properties?.sheetId === sheetId);
  const bandedRanges = (sheetMeta as { bandedRanges?: Array<{ bandedRangeId?: number | null }> } | undefined)?.bandedRanges ?? [];
  for (const banded of bandedRanges) {
    if (banded.bandedRangeId !== undefined && banded.bandedRangeId !== null) {
      requests.push({ deleteBanding: { bandedRangeId: banded.bandedRangeId } });
    }
  }

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
    },
  });

  requests.push({
    mergeCells: {
      range: gridRange(sheetId, TITLE_ROW, TITLE_ROW + 1, COL_MEMBER, COL_MONEY + 1),
      mergeType: "MERGE_ALL",
    },
  });
  requests.push(styleRange(sheetId, TITLE_ROW, TITLE_ROW + 1, COL_MEMBER, COL_MONEY + 1, {
    backgroundColor: TITLE_FILL,
    textFormat: { bold: true, fontSize: 16, foregroundColor: TEXT_LIGHT, fontFamily: "Google Sans" },
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
    padding: { top: 8, bottom: 8 },
  }));

  requests.push(styleRange(sheetId, SELECTOR_ROW, SELECTOR_ROW + 1, COL_MEMBER, COL_NICKNAME, {
    backgroundColor: SELECTOR_LABEL_FILL,
    textFormat: { bold: true, fontSize: 11, foregroundColor: TEXT_SUBTLE },
    horizontalAlignment: "RIGHT",
    verticalAlignment: "MIDDLE",
    padding: { right: 10 },
  }));
  requests.push({
    mergeCells: {
      range: gridRange(sheetId, SELECTOR_ROW, SELECTOR_ROW + 1, COL_NICKNAME, COL_MONEY + 1),
      mergeType: "MERGE_ALL",
    },
  });
  requests.push(styleRange(sheetId, SELECTOR_ROW, SELECTOR_ROW + 1, COL_NICKNAME, COL_MONEY + 1, {
    backgroundColor: SELECTOR_VALUE_FILL,
    textFormat: { bold: true, fontSize: 12, foregroundColor: TEXT_SUBTLE },
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
    borders: { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT },
  }));
  requests.push({
    setDataValidation: {
      range: gridRange(sheetId, SELECTOR_ROW, SELECTOR_ROW + 1, COL_NICKNAME, COL_MONEY + 1),
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: months.map((month) => ({ userEnteredValue: month.label })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  });

  requests.push({
    mergeCells: {
      range: gridRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_MEMBER, COL_POINT),
      mergeType: "MERGE_ALL",
    },
  });
  requests.push(styleRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_MEMBER, COL_MONEY + 1, {
    backgroundColor: TOTAL_FILL,
    textFormat: { bold: true, fontSize: 13, foregroundColor: TEXT_SUBTLE },
    verticalAlignment: "MIDDLE",
  }));
  requests.push(styleRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_MEMBER, COL_POINT, {
    horizontalAlignment: "CENTER",
  }));
  requests.push(styleRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_POINT, COL_MONEY + 1, {
    horizontalAlignment: "RIGHT",
    padding: { right: 12 },
  }));
  requests.push(numberFormatRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_POINT, COL_POINT + 1, "#,##0"));
  requests.push(numberFormatRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_MONEY, COL_MONEY + 1, `#,##0" ₫"`));

  requests.push(styleRange(sheetId, HEADER_ROW, HEADER_ROW + 1, COL_MEMBER, COL_MONEY + 1, {
    backgroundColor: SELECTOR_LABEL_FILL,
    textFormat: {
      bold: true,
      fontSize: 12,
      foregroundColor: TEXT_SUBTLE,
      foregroundColorStyle: { rgbColor: TEXT_SUBTLE },
    },
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
  }));
  requests.push(styleRange(sheetId, HEADER_ROW, HEADER_ROW + 1, COL_POINT, COL_MONEY + 1, {
    horizontalAlignment: "RIGHT",
    padding: { right: 12 },
  }));
  for (const spacerRow of [TITLE_ROW + 2, TOTAL_ROW + 1]) {
    requests.push(styleRange(sheetId, spacerRow, spacerRow + 1, COL_MEMBER, COL_MONEY + 1, {
      backgroundColor: WHITE_FILL,
    }));
  }

  requests.push(styleRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, COL_MEMBER, COL_POINT, {
    backgroundColor: WHITE_FILL,
    textFormat: { bold: true, fontSize: 11, foregroundColor: TEXT_SUBTLE },
    horizontalAlignment: "LEFT",
    verticalAlignment: "MIDDLE",
    padding: { left: 10 },
  }));
  requests.push(styleRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, COL_POINT, COL_MONEY + 1, {
    backgroundColor: WHITE_FILL,
    textFormat: { fontSize: 11 },
    horizontalAlignment: "RIGHT",
    verticalAlignment: "MIDDLE",
    padding: { right: 12 },
  }));
  requests.push(numberFormatRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, COL_POINT, COL_POINT + 1, "#,##0"));
  requests.push(numberFormatRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, COL_MONEY, COL_MONEY + 1, `#,##0" ₫"`));

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [gridRange(sheetId, FIRST_MEMBER_ROW, lastMemberRowExclusive, COL_MEMBER, COL_MONEY + 1)],
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
      range: gridRange(sheetId, HEADER_ROW, HEADER_ROW + 1, COL_MEMBER, COL_MONEY + 1),
      bottom: BORDER_STRONG,
    },
  });
  requests.push({
    updateBorders: {
      range: gridRange(sheetId, TOTAL_ROW, TOTAL_ROW + 1, COL_MEMBER, COL_MONEY + 1),
      top: BORDER_STRONG,
      bottom: BORDER_STRONG,
      left: BORDER_STRONG,
      right: BORDER_STRONG,
    },
  });

  requests.push(setColumnWidth(sheetId, COL_MEMBER, 200));
  requests.push(setColumnWidth(sheetId, COL_NICKNAME, 90));
  requests.push(setColumnWidth(sheetId, COL_ROLE, 130));
  requests.push(setColumnWidth(sheetId, COL_POINT, 110));
  requests.push(setColumnWidth(sheetId, COL_MONEY, 170));

  requests.push(setRowHeight(sheetId, TITLE_ROW - 1, 48));
  requests.push(setRowHeight(sheetId, SELECTOR_ROW - 1, 36));
  requests.push(setRowHeight(sheetId, TOTAL_ROW - 1, 40));
  requests.push(setRowHeight(sheetId, HEADER_ROW - 1, 30));

  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: COL_HIDDEN_DATE },
      properties: { hiddenByUser: false },
      fields: "hiddenByUser",
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: COL_HIDDEN_DATE, endIndex: COL_HIDDEN_DATE + 1 },
      properties: { hiddenByUser: true },
      fields: "hiddenByUser",
    },
  });

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { hideGridlines: true, frozenRowCount: HEADER_ROW, frozenColumnCount: 0 } },
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
  if (format.borders) parts.push("borders");
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
