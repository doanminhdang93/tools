import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { formatSection } from "../src/format-section.ts";
import { currentMonthLabel } from "../src/util/month.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TAB = process.argv[2];
const MONTH = process.argv[3] ?? currentMonthLabel(new Date());

if (!TAB) {
  console.error("Usage: tsx commands/format-section-like-dangdm.ts <Tab> [Month=current]");
  process.exit(1);
}

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  await formatSection({
    sheetsApi,
    spreadsheetId: appConfig.googleSheetsId,
    tabName: TAB,
    monthLabel: MONTH,
  });
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
