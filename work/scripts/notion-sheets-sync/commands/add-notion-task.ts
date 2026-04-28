import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { Client as NotionClient } from "@notionhq/client";
import { loadConfig } from "../src/config.ts";
import { COLUMN_INDEX, columnLetter, toSheetApp, toSheetStatus, moneyFormulaForRole } from "../src/constants.ts";
import { readMembers } from "../src/util/members.ts";
import { currentMonthLabel } from "../src/util/month.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TARGET_TAB = process.argv[2];
const NOTION_PAGE_ID = process.argv[3];
const OVERRIDE_POINTS = process.argv[4];
const TARGET_MONTH = process.argv[5] ?? currentMonthLabel(new Date());

if (!TARGET_TAB || !NOTION_PAGE_ID) {
  console.error("Usage: tsx commands/add-notion-task.ts <Tab> <NotionPageId> [overridePoints] [Month=current]");
  process.exit(1);
}

async function main() {
  const appConfig = loadConfig();
  const notion = new NotionClient({ auth: appConfig.notionApiKey });
  const page = await notion.pages.retrieve({ page_id: NOTION_PAGE_ID });
  if (!("properties" in page)) {
    throw new Error("Page has no properties");
  }
  const properties = page.properties as Record<string, { type: string; [key: string]: unknown }>;

  const titleProperty = Object.values(properties).find((p) => p.type === "title");
  const titleArray = (titleProperty as { title?: { plain_text?: string }[] })?.title ?? [];
  const title = titleArray.map((part) => part.plain_text ?? "").join("").trim();

  const assignees = ((properties["Assignee"] as { people?: { name?: string }[] })?.people ?? [])
    .map((person) => person.name ?? "")
    .filter(Boolean);
  const followers = ((properties["Follower"] as { people?: { name?: string }[] })?.people ?? [])
    .map((person) => person.name ?? "")
    .filter(Boolean);

  const tagsProperty = properties["Tag"] as { multi_select?: { name?: string }[] };
  const tagNames = (tagsProperty?.multi_select ?? [])
    .map((tag) => (tag.name ?? "").trim())
    .filter((name) => name.length > 0);
  const app = tagNames.map(toSheetApp).join(", ");

  const statusProperty = properties["Status"] as { status?: { name?: string }; select?: { name?: string } };
  const statusName = statusProperty?.status?.name ?? statusProperty?.select?.name ?? "";
  const status = statusName ? toSheetStatus(statusName) : "";

  const notionPoints = readSelectAsNumber(properties["Story Point"]) || readSelectAsNumber(properties["Size Card"]);
  const points = OVERRIDE_POINTS ? Number(OVERRIDE_POINTS) : notionPoints;
  const link = `https://www.notion.so/${page.id.replace(/-/g, "")}`;

  console.log(`Adding Notion task to ${TARGET_TAB} section ${TARGET_MONTH}:`);
  console.log(`  Title: ${title}`);
  console.log(`  App: ${app}, Status: ${status}, Points: ${points} (Notion=${notionPoints})`);
  console.log(`  Assignees: ${assignees.join(", ")}`);

  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const spreadsheetId = appConfig.googleSheetsId;

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const tabSheet = workbook.data.sheets?.find((sheet) => sheet.properties?.title === TARGET_TAB);
  const sheetId = tabSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab "${TARGET_TAB}" not found`);
  }

  const valuesResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${TARGET_TAB}!A:B`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = valuesResp.data.values ?? [];

  let headerRowZeroBased = -1;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    if ((rows[rowIndex]?.[0] ?? "").toString().trim() === TARGET_MONTH) {
      headerRowZeroBased = rowIndex;
      break;
    }
  }
  if (headerRowZeroBased < 0) {
    throw new Error(`Section "${TARGET_MONTH}" not found in ${TARGET_TAB}`);
  }

  let lastTaskRowZeroBased = headerRowZeroBased;
  for (let rowIndex = headerRowZeroBased + 1; rowIndex < rows.length; rowIndex++) {
    const colA = (rows[rowIndex]?.[0] ?? "").toString().trim();
    const colB = (rows[rowIndex]?.[1] ?? "").toString().trim();
    if (colA) break;
    if (!colB) break;
    lastTaskRowZeroBased = rowIndex;
  }

  const insertAtZeroBased = lastTaskRowZeroBased + 1;
  const currentRowCount = tabSheet?.properties?.gridProperties?.rowCount ?? 1000;
  if (insertAtZeroBased >= currentRowCount) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: "ROWS", length: 50 } }],
      },
    });
  }
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: insertAtZeroBased, endIndex: insertAtZeroBased + 1 },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  const insertAtOneBased = insertAtZeroBased + 1;
  const newRow: (string | number)[] = new Array(COLUMN_INDEX.followers + 1).fill("");
  newRow[COLUMN_INDEX.title] = title;
  newRow[COLUMN_INDEX.link] = link;
  newRow[COLUMN_INDEX.app] = app;
  newRow[COLUMN_INDEX.status] = status;
  newRow[COLUMN_INDEX.point] = points;
  newRow[COLUMN_INDEX.assignees] = assignees.join(", ");
  newRow[COLUMN_INDEX.followers] = followers.join(", ");

  const lastCol = columnLetter(COLUMN_INDEX.followers);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${TARGET_TAB}!A${insertAtOneBased}:${lastCol}${insertAtOneBased}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [newRow] },
  });
  console.log(`✔ inserted row ${insertAtOneBased}`);

  const members = await readMembers().catch(() => []);
  const memberRole = members.find((m) => m.tabName === TARGET_TAB)?.role ?? "";

  const headerOneBased = headerRowZeroBased + 1;
  const firstTaskOneBased = headerOneBased + 1;
  const lastTaskOneBased = insertAtOneBased;
  const pointCol = columnLetter(COLUMN_INDEX.point);
  const moneyCol = columnLetter(COLUMN_INDEX.money);
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${TARGET_TAB}!${pointCol}${headerOneBased}:${moneyCol}${headerOneBased}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          `=SUM(${pointCol}${firstTaskOneBased}:${pointCol}${lastTaskOneBased})`,
          moneyFormulaForRole(memberRole, pointCol, headerOneBased),
        ],
      ],
    },
  });
  console.log(`✔ updated header SUM range = ${pointCol}${firstTaskOneBased}:${pointCol}${lastTaskOneBased}`);
}

function readSelectAsNumber(property: { type: string; [key: string]: unknown } | undefined): number {
  if (!property || property.type !== "select") return 0;
  const select = (property as { select?: { name?: string } | null }).select;
  if (!select?.name) return 0;
  const asNumber = Number(select.name);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
