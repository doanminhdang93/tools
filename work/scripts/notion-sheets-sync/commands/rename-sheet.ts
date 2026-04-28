import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../src/config.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const NEW_TITLE = process.argv[2];
if (!NEW_TITLE) {
  console.error('Usage: tsx commands/rename-sheet.ts "<New Title>"');
  process.exit(1);
}

async function main() {
  const appConfig = loadConfig();
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth });

  const before = await sheetsApi.spreadsheets.get({
    spreadsheetId: appConfig.googleSheetsId,
    fields: "properties.title",
  });
  console.log(`Current title: "${before.data.properties?.title}"`);

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: appConfig.googleSheetsId,
    requestBody: {
      requests: [{
        updateSpreadsheetProperties: {
          properties: { title: NEW_TITLE },
          fields: "title",
        },
      }],
    },
  });
  console.log(`Renamed to: "${NEW_TITLE}"`);
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
