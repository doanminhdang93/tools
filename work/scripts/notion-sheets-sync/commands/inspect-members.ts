import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { parseTab } from "../src/sheets/parser.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

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

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const spreadsheetId = appConfig.googleSheetsId;

  for (const memberTab of TEAM_TABS) {
    const valuesResp = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${memberTab}!A:J`,
    });
    const rows = (valuesResp.data.values ?? []).map((row) =>
      row.map((cell) => (cell ?? "").toString()),
    );
    const parsed = parseTab(rows);
    console.log(`\n=== ${memberTab} ===`);
    console.log(`Total sections: ${parsed.sections.length}`);
    for (const section of parsed.sections) {
      const taskCount = section.lastRowIndex - section.headerRowIndex;
      const kind = taskCount === 0 ? "placeholder" : `${taskCount} task(s)`;
      console.log(`  ${section.monthLabel}  row ${section.headerRowIndex}  ${kind}`);
    }
  }
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
