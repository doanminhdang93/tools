import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../src/config.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });

  const workbook = await sheetsApi.spreadsheets.get({
    spreadsheetId: appConfig.googleSheetsId,
  });

  console.log("Current tabs:");
  for (const sheet of workbook.data.sheets ?? []) {
    console.log(`  - ${sheet.properties?.title} (sheetId=${sheet.properties?.sheetId})`);
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
