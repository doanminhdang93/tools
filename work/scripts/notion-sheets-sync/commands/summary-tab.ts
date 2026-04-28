import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { parseTab } from "../src/sheets/parser.ts";
import { COLUMN_INDEX, columnLetter } from "../src/constants.ts";
import { readMembers } from "../src/util/members.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

let MEMBER_TABS: string[] = [];
const DEFAULT_MEMBER = "DangDM";
const SUMMARY_TAB = "Summary";

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
const SELECTOR_FILL = rgb("#e8f5e9");
const SELECTOR_VALUE_FILL = rgb("#ffffff");
const TOTAL_FILL = rgb("#a5d6a7");
const STRIPE_FILL = rgb("#f6faf4");
const WHITE_FILL = rgb("#ffffff");
const HEADER_TEXT = rgb("#ffffff");
const SUBTLE_TEXT = rgb("#33691e");
const BORDER_STRONG = { style: "SOLID_MEDIUM" as const, color: rgb("#2e7d32") };
const BORDER_LIGHT = { style: "SOLID" as const, color: rgb("#c8e6c9") };

// B = col 1, C = col 2, D = col 3 (0-based)
const COL_MONTH = 1;
const COL_POINT = 2;
const COL_MONEY = 3;

// Rank table: G H I J (cols 6..9), helper cells hidden in L M N (cols 11..13)
const COL_RANK_NUMBER = 6;
const COL_RANK_MEMBER = 7;
const COL_RANK_POINT = 8;
const COL_RANK_MONEY = 9;
const COL_RANK_HELPER_TAB = 11;
const COL_RANK_HELPER_POINT = 12;
const COL_RANK_HELPER_MONEY = 13;

const TITLE_ROW = 1;
const MEMBER_ROW = 2;
const SORT_ROW = 3;
const TOTAL_ROW = 4;
const SPACER_ROW = 5;
const HEADER_ROW = 6;
const FIRST_MONTH_ROW = 7;
const LAST_MONTH_ROW = 200;
const SORT_DESC_LABEL = "Newest first";
const SORT_ASC_LABEL = "Oldest first";
const RANK_SORT_POINT_LABEL = "Point";
const RANK_SORT_MONEY_LABEL = "Money";

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const spreadsheetId = appConfig.googleSheetsId;

  const members = await readMembers();
  MEMBER_TABS = members.map((member) => member.tabName);
  console.log(`Loaded ${MEMBER_TABS.length} members from Members tab.`);

  const { unionLabels, maxPerMember } = await collectAllMonthLabels(sheetsApi, spreadsheetId);
  console.log(
    `Collected ${unionLabels.length} unique months across members; max per-member = ${maxPerMember}.`,
  );

  await removeSummaryFromDangDM(sheetsApi, spreadsheetId);
  console.log(`✔ removed existing summary block from DangDM`);

  const { sheetId: summarySheetId, preservedMember, preservedRankSort } = await ensureSummaryTab(
    sheetsApi,
    spreadsheetId,
  );
  console.log(
    `✔ Summary tab ready (sheetId=${summarySheetId}, preserved member=${preservedMember ?? "none"}, preserved rank sort=${preservedRankSort ?? RANK_SORT_POINT_LABEL})`,
  );

  await writeSummaryContent(sheetsApi, spreadsheetId, maxPerMember, preservedMember, preservedRankSort);
  console.log(`✔ wrote summary content (capacity ${maxPerMember} rows, ${MEMBER_TABS.length} ranked members)`);

  await applySummaryFormatting(sheetsApi, spreadsheetId, summarySheetId, maxPerMember);
  console.log(`✔ applied formatting`);

  console.log("\nAll done.");
}

async function collectAllMonthLabels(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<{ unionLabels: string[]; maxPerMember: number }> {
  const unionMonths = new Set<string>();
  let maxPerMember = 0;
  for (const memberTab of MEMBER_TABS) {
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${memberTab}!A:Z`,
    });
    const rows = (response.data.values ?? []).map((row) =>
      row.map((cell) => (cell ?? "").toString()),
    );
    const parsed = parseTab(rows);
    const memberMonths = new Set<string>();
    for (const section of parsed.sections) {
      unionMonths.add(section.monthLabel);
      memberMonths.add(section.monthLabel);
    }
    if (memberMonths.size > maxPerMember) maxPerMember = memberMonths.size;
  }
  return {
    unionLabels: [...unionMonths].sort(compareMonthLabels),
    maxPerMember,
  };
}

async function removeSummaryFromDangDM(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<void> {
  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const dangdmSheet = workbook.data.sheets?.find((sheet) => sheet.properties?.title === "DangDM");
  const dangdmSheetId = dangdmSheet?.properties?.sheetId;
  if (dangdmSheetId === undefined || dangdmSheetId === null) return;

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `DangDM!A:J`,
  });
  const rows = (response.data.values ?? []).map((row) =>
    row.map((cell) => (cell ?? "").toString()),
  );

  let totalRowIndex = -1;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if ((row?.[COL_MONTH] ?? "").toString().trim() === "Total") {
      totalRowIndex = rowIndex;
      break;
    }
    if (/^\d{1,2}\/\d{4}$/.test((row?.[0] ?? "").toString().trim())) break;
  }
  if (totalRowIndex === -1) {
    console.log(`  (no inline summary block detected on DangDM — skipping removal)`);
    return;
  }

  const lastDeleteRowOneBased = totalRowIndex + 2;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: dangdmSheetId,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: lastDeleteRowOneBased,
            },
          },
        },
      ],
    },
  });
}

async function ensureSummaryTab(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<{ sheetId: number; preservedMember: string | null; preservedRankSort: string | null }> {
  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existing = workbook.data.sheets?.find(
    (sheet) => sheet.properties?.title === SUMMARY_TAB,
  );
  if (existing?.properties?.sheetId !== undefined && existing.properties.sheetId !== null) {
    const sheetId = existing.properties.sheetId;
    const currentColumnCount = existing.properties.gridProperties?.columnCount ?? 10;
    const requiredColumnCount = COL_RANK_HELPER_MONEY + 1;
    if (currentColumnCount < requiredColumnCount) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            appendDimension: {
              sheetId,
              dimension: "COLUMNS",
              length: requiredColumnCount - currentColumnCount,
            },
          }],
        },
      });
    }

    const selectorResponse = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${SUMMARY_TAB}!C2:H3`,
    });
    const memberSelection = (selectorResponse.data.values?.[0]?.[0] ?? "").toString().trim();
    const preservedMember = MEMBER_TABS.includes(memberSelection) ? memberSelection : null;
    const rankSortRaw = (selectorResponse.data.values?.[1]?.[5] ?? "").toString().trim();
    const preservedRankSort = rankSortRaw === RANK_SORT_MONEY_LABEL ? RANK_SORT_MONEY_LABEL : null;

    await sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SUMMARY_TAB}!A:Z`,
    });
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            unmergeCells: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 200,
                startColumnIndex: 0,
                endColumnIndex: 10,
              },
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 4 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });
    return { sheetId, preservedMember, preservedRankSort };
  }

  const response = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: SUMMARY_TAB,
              gridProperties: { rowCount: 200, columnCount: 14, frozenRowCount: 4 },
              index: 0,
            },
          },
        },
      ],
    },
  });
  const addedSheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (addedSheetId === undefined || addedSheetId === null) {
    throw new Error(`Failed to create "${SUMMARY_TAB}" tab`);
  }
  return { sheetId: addedSheetId, preservedMember: null, preservedRankSort: null };
}

async function writeSummaryContent(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  capacityRows: number,
  preservedMember: string | null,
  preservedRankSort: string | null,
): Promise<void> {
  const selectedMember = preservedMember ?? DEFAULT_MEMBER;
  const selectedRankSort = preservedRankSort ?? RANK_SORT_POINT_LABEL;
  const pointCol = columnLetter(COLUMN_INDEX.point);
  const moneyCol = columnLetter(COLUMN_INDEX.money);
  const memberRef = `INDIRECT("'"&$C$2&"'!A:A")`;
  const pointColRef = `INDIRECT("'"&$C$2&"'!${pointCol}:${pointCol}")`;
  const moneyColRef = `INDIRECT("'"&$C$2&"'!${moneyCol}:${moneyCol}")`;
  const dataEndRow = FIRST_MONTH_ROW + Math.max(capacityRows, 1) - 1;

  const monthSpillFormula =
    `=IFERROR(SORT(UNIQUE(FILTER(${memberRef},ISNUMBER(${memberRef}))),` +
    `1,$C$3=${JSON.stringify(SORT_ASC_LABEL)}),"")`;
  const pointSpillFormula =
    `=ARRAYFORMULA(IF(B${FIRST_MONTH_ROW}:B${dataEndRow}="","",` +
    `IFERROR(VLOOKUP(B${FIRST_MONTH_ROW}:B${dataEndRow},` +
    `{${memberRef},${pointColRef}},2,FALSE),0)))`;
  const moneySpillFormula =
    `=ARRAYFORMULA(IF(B${FIRST_MONTH_ROW}:B${dataEndRow}="","",` +
    `IFERROR(VLOOKUP(B${FIRST_MONTH_ROW}:B${dataEndRow},` +
    `{${memberRef},${moneyColRef}},2,FALSE),0)))`;

  const updates: sheets_v4.Schema$ValueRange[] = [
    { range: `${SUMMARY_TAB}!B${TITLE_ROW}`, values: [["Monthly Summary"]] },
    { range: `${SUMMARY_TAB}!B${MEMBER_ROW}`, values: [["Member"]] },
    { range: `${SUMMARY_TAB}!C${MEMBER_ROW}`, values: [[selectedMember]] },
    { range: `${SUMMARY_TAB}!B${SORT_ROW}`, values: [["Sort"]] },
    { range: `${SUMMARY_TAB}!C${SORT_ROW}`, values: [[SORT_DESC_LABEL]] },
    {
      range: `${SUMMARY_TAB}!B${TOTAL_ROW}:D${TOTAL_ROW}`,
      values: [
        [
          "Total",
          `=SUM(C${FIRST_MONTH_ROW}:C${dataEndRow})`,
          `=SUM(D${FIRST_MONTH_ROW}:D${dataEndRow})`,
        ],
      ],
    },
    { range: `${SUMMARY_TAB}!B${HEADER_ROW}:D${HEADER_ROW}`, values: [["Month", "Point", "Money"]] },
    { range: `${SUMMARY_TAB}!B${FIRST_MONTH_ROW}`, values: [[monthSpillFormula]] },
    { range: `${SUMMARY_TAB}!C${FIRST_MONTH_ROW}`, values: [[pointSpillFormula]] },
    { range: `${SUMMARY_TAB}!D${FIRST_MONTH_ROW}`, values: [[moneySpillFormula]] },
  ];

  const rankUpdates = buildRankUpdates(selectedRankSort);
  updates.push(...rankUpdates);

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates,
    },
  });
}

function buildRankUpdates(selectedRankSort: string): sheets_v4.Schema$ValueRange[] {
  const memberPointCol = columnLetter(COLUMN_INDEX.point);
  const memberMoneyCol = columnLetter(COLUMN_INDEX.money);
  const rankNumberCol = columnLetter(COL_RANK_NUMBER);
  const rankMemberCol = columnLetter(COL_RANK_MEMBER);
  const rankPointCol = columnLetter(COL_RANK_POINT);
  const rankMoneyCol = columnLetter(COL_RANK_MONEY);
  const helperTabCol = columnLetter(COL_RANK_HELPER_TAB);
  const helperPointCol = columnLetter(COL_RANK_HELPER_POINT);
  const helperMoneyCol = columnLetter(COL_RANK_HELPER_MONEY);

  const rankFirstRow = FIRST_MONTH_ROW;
  const rankLastRow = rankFirstRow + MEMBER_TABS.length - 1;

  const helperRows = MEMBER_TABS.map((tabName) => [
    tabName,
    `=SUMIF('${tabName}'!A:A, "<>", '${tabName}'!${memberPointCol}:${memberPointCol})`,
    `=SUMIF('${tabName}'!A:A, "<>", '${tabName}'!${memberMoneyCol}:${memberMoneyCol})`,
  ]);

  const sortColumnExpression = `IF($${rankMemberCol}$${SORT_ROW}=${JSON.stringify(RANK_SORT_MONEY_LABEL)},3,2)`;
  const sortRangeExpression = `${helperTabCol}${rankFirstRow}:${helperMoneyCol}${rankLastRow}`;
  const sortSpillFormula = `=IFERROR(SORT(${sortRangeExpression},${sortColumnExpression},FALSE),"")`;
  const rankNumberSpillFormula =
    `=ARRAYFORMULA(IF(${rankMemberCol}${rankFirstRow}:${rankMemberCol}${rankLastRow}="","",` +
    `ROW(${rankMemberCol}${rankFirstRow}:${rankMemberCol}${rankLastRow})-${rankFirstRow - 1}))`;
  const totalPointFormula = `=SUM(${rankPointCol}${rankFirstRow}:${rankPointCol}${rankLastRow})`;
  const totalMoneyFormula = `=SUM(${rankMoneyCol}${rankFirstRow}:${rankMoneyCol}${rankLastRow})`;

  return [
    { range: `${SUMMARY_TAB}!${rankNumberCol}${TITLE_ROW}`, values: [["Member Ranking"]] },
    { range: `${SUMMARY_TAB}!${rankNumberCol}${SORT_ROW}`, values: [["Sort by"]] },
    { range: `${SUMMARY_TAB}!${rankMemberCol}${SORT_ROW}`, values: [[selectedRankSort]] },
    {
      range: `${SUMMARY_TAB}!${rankNumberCol}${TOTAL_ROW}:${rankMoneyCol}${TOTAL_ROW}`,
      values: [["Total", `=COUNTA(${rankMemberCol}${rankFirstRow}:${rankMemberCol}${rankLastRow})`, totalPointFormula, totalMoneyFormula]],
    },
    {
      range: `${SUMMARY_TAB}!${rankNumberCol}${HEADER_ROW}:${rankMoneyCol}${HEADER_ROW}`,
      values: [["Rank", "Member", "Point", "Money"]],
    },
    {
      range: `${SUMMARY_TAB}!${helperTabCol}${rankFirstRow}:${helperMoneyCol}${rankLastRow}`,
      values: helperRows,
    },
    { range: `${SUMMARY_TAB}!${rankNumberCol}${rankFirstRow}`, values: [[rankNumberSpillFormula]] },
    { range: `${SUMMARY_TAB}!${rankMemberCol}${rankFirstRow}`, values: [[sortSpillFormula]] },
  ];
}

async function applySummaryFormatting(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  monthCount: number,
): Promise<void> {
  const requests: sheets_v4.Schema$Request[] = [];

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheetMetadata = workbook.data.sheets?.find(
    (sheet) => sheet.properties?.sheetId === sheetId,
  );
  for (const group of sheetMetadata?.rowGroups ?? []) {
    if (!group.range) continue;
    requests.push({
      deleteDimensionGroup: {
        range: { ...group.range, sheetId, dimension: "ROWS" },
      },
    });
  }
  const existingRuleCount = sheetMetadata?.conditionalFormats?.length ?? 0;
  for (let ruleIndex = 0; ruleIndex < existingRuleCount; ruleIndex++) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: 0 } });
  }

  requests.push(
    {
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: LAST_MONTH_ROW + 10,
          startColumnIndex: 0,
          endColumnIndex: COL_MONEY + 3,
        },
        top: { style: "NONE" },
        bottom: { style: "NONE" },
        left: { style: "NONE" },
        right: { style: "NONE" },
        innerHorizontal: { style: "NONE" },
        innerVertical: { style: "NONE" },
      },
    },
    fillPage(sheetId, 1, LAST_MONTH_ROW + 5, 0, COL_MONEY + 2, WHITE_FILL),
    mergeRange(sheetId, TITLE_ROW, TITLE_ROW, COL_MONTH, COL_MONEY + 1),
    styleRange(sheetId, TITLE_ROW, TITLE_ROW, COL_MONTH, COL_MONEY + 1, {
      backgroundColor: TITLE_FILL,
      textFormat: {
        bold: true,
        fontSize: 18,
        foregroundColor: HEADER_TEXT,
        fontFamily: "Google Sans",
      },
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      padding: { top: 8, bottom: 8, left: 8, right: 8 },
    }),
  );

  for (const row of [MEMBER_ROW, SORT_ROW]) {
    requests.push(
      styleRange(sheetId, row, row, COL_MONTH, COL_MONTH + 1, {
        backgroundColor: SELECTOR_FILL,
        textFormat: { bold: true, fontSize: 11, foregroundColor: SUBTLE_TEXT },
        horizontalAlignment: "RIGHT",
        verticalAlignment: "MIDDLE",
        padding: { right: 10 },
      }),
      mergeRange(sheetId, row, row, COL_POINT, COL_MONEY + 1),
      styleRange(sheetId, row, row, COL_POINT, COL_MONEY + 1, {
        backgroundColor: SELECTOR_VALUE_FILL,
        textFormat: { bold: true, fontSize: 12, foregroundColor: SUBTLE_TEXT },
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        borders: {
          top: BORDER_LIGHT,
          bottom: BORDER_LIGHT,
          left: BORDER_LIGHT,
          right: BORDER_LIGHT,
        },
      }),
    );
  }

  requests.push(
    {
      setDataValidation: {
        range: gridRange(sheetId, MEMBER_ROW, MEMBER_ROW, COL_POINT, COL_MONEY + 1),
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: MEMBER_TABS.map((member) => ({ userEnteredValue: member })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: gridRange(sheetId, SORT_ROW, SORT_ROW, COL_POINT, COL_MONEY + 1),
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [SORT_DESC_LABEL, SORT_ASC_LABEL].map((label) => ({
              userEnteredValue: label,
            })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
  );

  requests.push(
    styleRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_MONTH, COL_MONEY + 1, {
      backgroundColor: TOTAL_FILL,
      textFormat: { bold: true, fontSize: 13, foregroundColor: SUBTLE_TEXT },
      verticalAlignment: "MIDDLE",
    }),
    styleRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_MONTH, COL_MONTH + 1, {
      horizontalAlignment: "CENTER",
    }),
    styleRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_POINT, COL_MONEY + 1, {
      horizontalAlignment: "RIGHT",
      padding: { right: 12 },
    }),
    numberFormatRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_POINT, COL_POINT + 1, "#,##0"),
    numberFormatRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_MONEY, COL_MONEY + 1, `#,##0" ₫"`),
  );

  requests.push(
    styleRange(sheetId, HEADER_ROW, HEADER_ROW, COL_MONTH, COL_MONEY + 1, {
      backgroundColor: HEADER_FILL,
      textFormat: {
        bold: true,
        fontSize: 11,
        foregroundColor: HEADER_TEXT,
      },
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
    }),
  );

  requests.push(
    styleRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_MONTH, COL_MONEY + 1, {
      backgroundColor: WHITE_FILL,
      textFormat: { fontSize: 11 },
      verticalAlignment: "MIDDLE",
    }),
    styleRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_MONTH, COL_MONTH + 1, {
      horizontalAlignment: "CENTER",
    }),
    styleRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_POINT, COL_MONEY + 1, {
      horizontalAlignment: "RIGHT",
      padding: { right: 12 },
    }),
  );

  requests.push(
    dateFormatRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_MONTH, COL_MONTH + 1, "m/yyyy"),
    numberFormatRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_POINT, COL_POINT + 1, "#,##0"),
    numberFormatRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_MONEY, COL_MONEY + 1, `#,##0" ₫"`),
  );

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [gridRange(sheetId, FIRST_MONTH_ROW, LAST_MONTH_ROW, COL_MONTH, COL_MONEY + 1)],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [
              {
                userEnteredValue: `=AND($B${FIRST_MONTH_ROW}<>"",ISEVEN(ROW()))`,
              },
            ],
          },
          format: { backgroundColor: STRIPE_FILL },
        },
      },
      index: 0,
    },
  });

  requests.push({
    updateBorders: {
      range: gridRange(sheetId, HEADER_ROW, HEADER_ROW, COL_MONTH, COL_MONEY + 1),
      bottom: BORDER_STRONG,
    },
  });
  requests.push({
    updateBorders: {
      range: gridRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_MONTH, COL_MONEY + 1),
      top: BORDER_STRONG,
      bottom: BORDER_STRONG,
      left: BORDER_STRONG,
      right: BORDER_STRONG,
    },
  });

  requests.push(
    setColumnWidth(sheetId, 0, 40),
    setColumnWidth(sheetId, COL_MONTH, 130),
    setColumnWidth(sheetId, COL_POINT, 120),
    setColumnWidth(sheetId, COL_MONEY, 180),
    setColumnWidth(sheetId, COL_MONEY + 1, 40),
    setRowHeight(sheetId, TITLE_ROW - 1, 56),
    setRowHeight(sheetId, MEMBER_ROW - 1, 36),
    setRowHeight(sheetId, SORT_ROW - 1, 36),
    setRowHeight(sheetId, TOTAL_ROW - 1, 44),
    setRowHeight(sheetId, SPACER_ROW - 1, 12),
    setRowHeight(sheetId, HEADER_ROW - 1, 32),
  );

  requests.push(hideGridlines(sheetId));
  requests.push({ clearBasicFilter: { sheetId } });

  const dataEndRow = FIRST_MONTH_ROW + Math.max(monthCount, 1) - 1;
  requests.push({
    addDimensionGroup: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: FIRST_MONTH_ROW - 1,
        endIndex: dataEndRow,
      },
    },
  });

  requests.push(...buildRankFormattingRequests(sheetId));

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

function buildRankFormattingRequests(sheetId: number): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];
  const rankFirstRow = FIRST_MONTH_ROW;
  const rankLastRow = Math.max(rankFirstRow + MEMBER_TABS.length - 1, rankFirstRow);

  requests.push(
    fillPage(sheetId, 1, LAST_MONTH_ROW + 5, COL_RANK_NUMBER, COL_RANK_MONEY + 1, WHITE_FILL),
    mergeRange(sheetId, TITLE_ROW, TITLE_ROW, COL_RANK_NUMBER, COL_RANK_MONEY + 1),
    styleRange(sheetId, TITLE_ROW, TITLE_ROW, COL_RANK_NUMBER, COL_RANK_MONEY + 1, {
      backgroundColor: TITLE_FILL,
      textFormat: {
        bold: true,
        fontSize: 18,
        foregroundColor: HEADER_TEXT,
        fontFamily: "Google Sans",
      },
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      padding: { top: 8, bottom: 8, left: 8, right: 8 },
    }),
    styleRange(sheetId, SORT_ROW, SORT_ROW, COL_RANK_NUMBER, COL_RANK_NUMBER + 1, {
      backgroundColor: SELECTOR_FILL,
      textFormat: { bold: true, fontSize: 11, foregroundColor: SUBTLE_TEXT },
      horizontalAlignment: "RIGHT",
      verticalAlignment: "MIDDLE",
      padding: { right: 10 },
    }),
    mergeRange(sheetId, SORT_ROW, SORT_ROW, COL_RANK_MEMBER, COL_RANK_MONEY + 1),
    styleRange(sheetId, SORT_ROW, SORT_ROW, COL_RANK_MEMBER, COL_RANK_MONEY + 1, {
      backgroundColor: SELECTOR_VALUE_FILL,
      textFormat: { bold: true, fontSize: 12, foregroundColor: SUBTLE_TEXT },
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      borders: {
        top: BORDER_LIGHT,
        bottom: BORDER_LIGHT,
        left: BORDER_LIGHT,
        right: BORDER_LIGHT,
      },
    }),
    {
      setDataValidation: {
        range: gridRange(sheetId, SORT_ROW, SORT_ROW, COL_RANK_MEMBER, COL_RANK_MONEY + 1),
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [RANK_SORT_POINT_LABEL, RANK_SORT_MONEY_LABEL].map((label) => ({
              userEnteredValue: label,
            })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    styleRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_RANK_NUMBER, COL_RANK_MONEY + 1, {
      backgroundColor: TOTAL_FILL,
      textFormat: { bold: true, fontSize: 13, foregroundColor: SUBTLE_TEXT },
      verticalAlignment: "MIDDLE",
    }),
    styleRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_RANK_NUMBER, COL_RANK_MEMBER + 1, {
      horizontalAlignment: "CENTER",
    }),
    styleRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_RANK_POINT, COL_RANK_MONEY + 1, {
      horizontalAlignment: "RIGHT",
      padding: { right: 12 },
    }),
    numberFormatRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_RANK_POINT, COL_RANK_POINT + 1, "#,##0"),
    numberFormatRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_RANK_MONEY, COL_RANK_MONEY + 1, `#,##0" ₫"`),
    styleRange(sheetId, HEADER_ROW, HEADER_ROW, COL_RANK_NUMBER, COL_RANK_MONEY + 1, {
      backgroundColor: HEADER_FILL,
      textFormat: { bold: true, fontSize: 11, foregroundColor: HEADER_TEXT },
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
    }),
    styleRange(sheetId, rankFirstRow, rankLastRow, COL_RANK_NUMBER, COL_RANK_MONEY + 1, {
      backgroundColor: WHITE_FILL,
      textFormat: { fontSize: 11 },
      verticalAlignment: "MIDDLE",
    }),
    styleRange(sheetId, rankFirstRow, rankLastRow, COL_RANK_NUMBER, COL_RANK_MEMBER + 1, {
      horizontalAlignment: "CENTER",
    }),
    styleRange(sheetId, rankFirstRow, rankLastRow, COL_RANK_POINT, COL_RANK_MONEY + 1, {
      horizontalAlignment: "RIGHT",
      padding: { right: 12 },
    }),
    numberFormatRange(sheetId, rankFirstRow, rankLastRow, COL_RANK_POINT, COL_RANK_POINT + 1, "#,##0"),
    numberFormatRange(sheetId, rankFirstRow, rankLastRow, COL_RANK_MONEY, COL_RANK_MONEY + 1, `#,##0" ₫"`),
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [gridRange(sheetId, rankFirstRow, rankLastRow, COL_RANK_NUMBER, COL_RANK_MONEY + 1)],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: `=AND($H${rankFirstRow}<>"",ISEVEN(ROW()))` }],
            },
            format: { backgroundColor: STRIPE_FILL },
          },
        },
        index: 0,
      },
    },
    {
      updateBorders: {
        range: gridRange(sheetId, HEADER_ROW, HEADER_ROW, COL_RANK_NUMBER, COL_RANK_MONEY + 1),
        bottom: BORDER_STRONG,
      },
    },
    {
      updateBorders: {
        range: gridRange(sheetId, TOTAL_ROW, TOTAL_ROW, COL_RANK_NUMBER, COL_RANK_MONEY + 1),
        top: BORDER_STRONG,
        bottom: BORDER_STRONG,
        left: BORDER_STRONG,
        right: BORDER_STRONG,
      },
    },
    setColumnWidth(sheetId, COL_RANK_NUMBER - 1, 24),
    setColumnWidth(sheetId, COL_RANK_NUMBER, 60),
    setColumnWidth(sheetId, COL_RANK_MEMBER, 140),
    setColumnWidth(sheetId, COL_RANK_POINT, 100),
    setColumnWidth(sheetId, COL_RANK_MONEY, 140),
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: COL_RANK_HELPER_TAB,
          endIndex: COL_RANK_HELPER_MONEY + 1,
        },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
  );

  return requests;
}

function styleRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
  format: sheets_v4.Schema$CellFormat,
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: gridRange(
        sheetId,
        firstRowOneBased,
        lastRowOneBased,
        startColumnZeroBased,
        endColumnZeroBased,
      ),
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

function fillPage(
  sheetId: number,
  firstRowOneBased: number,
  lastRowOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
  fill: { red: number; green: number; blue: number },
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: gridRange(
        sheetId,
        firstRowOneBased,
        lastRowOneBased,
        startColumnZeroBased,
        endColumnZeroBased,
      ),
      cell: { userEnteredFormat: { backgroundColor: fill } },
      fields: "userEnteredFormat.backgroundColor",
    },
  };
}

function mergeRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
): sheets_v4.Schema$Request {
  return {
    mergeCells: {
      range: gridRange(
        sheetId,
        firstRowOneBased,
        lastRowOneBased,
        startColumnZeroBased,
        endColumnZeroBased,
      ),
      mergeType: "MERGE_ALL",
    },
  };
}

function numberFormatRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
  pattern: string,
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: gridRange(
        sheetId,
        firstRowOneBased,
        lastRowOneBased,
        startColumnZeroBased,
        endColumnZeroBased,
      ),
      cell: {
        userEnteredFormat: { numberFormat: { type: "NUMBER", pattern } },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  };
}

function dateFormatRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
  pattern: string,
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: gridRange(
        sheetId,
        firstRowOneBased,
        lastRowOneBased,
        startColumnZeroBased,
        endColumnZeroBased,
      ),
      cell: {
        userEnteredFormat: { numberFormat: { type: "DATE", pattern } },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  };
}

function setColumnWidth(
  sheetId: number,
  columnZeroBased: number,
  pixelSize: number,
): sheets_v4.Schema$Request {
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: columnZeroBased,
        endIndex: columnZeroBased + 1,
      },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

function setRowHeight(
  sheetId: number,
  rowZeroBased: number,
  pixelSize: number,
): sheets_v4.Schema$Request {
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowZeroBased,
        endIndex: rowZeroBased + 1,
      },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

function hideGridlines(sheetId: number): sheets_v4.Schema$Request {
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { hideGridlines: true } },
      fields: "gridProperties.hideGridlines",
    },
  };
}

function gridRange(
  sheetId: number,
  firstRowOneBased: number,
  lastRowOneBased: number,
  startColumnZeroBased: number,
  endColumnZeroBased: number,
): sheets_v4.Schema$GridRange {
  return {
    sheetId,
    startRowIndex: firstRowOneBased - 1,
    endRowIndex: lastRowOneBased,
    startColumnIndex: startColumnZeroBased,
    endColumnIndex: endColumnZeroBased,
  };
}

function compareMonthLabels(left: string, right: string): number {
  const [leftMonth, leftYear] = left.split("/").map(Number);
  const [rightMonth, rightYear] = right.split("/").map(Number);
  if (leftYear !== rightYear) return leftYear - rightYear;
  return leftMonth - rightMonth;
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
