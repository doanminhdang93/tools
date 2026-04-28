import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../src/config.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TAB = process.argv[2];
const MONTH = process.argv[3];

if (!TAB || !MONTH) {
  console.error("Usage: tsx commands/delete-section.ts <Tab> <M/YYYY>");
  process.exit(1);
}

async function main() {
  const appConfig = loadConfig();
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth });
  const spreadsheetId = appConfig.googleSheetsId;

  const workbook = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheetMeta = workbook.data.sheets?.find((s) => s.properties?.title === TAB);
  const sheetId = sheetMeta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error(`Tab "${TAB}" not found`);

  const valuesResponse = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A:A`,
  });
  const rows = valuesResponse.data.values ?? [];

  let headerZeroBased = -1;
  let nextSectionZeroBased = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] ?? "").toString().trim();
    if (cellA === MONTH) {
      headerZeroBased = i;
      for (let j = i + 1; j < rows.length; j++) {
        const nextA = (rows[j]?.[0] ?? "").toString().trim();
        if (nextA && nextA !== MONTH) {
          nextSectionZeroBased = j;
          break;
        }
      }
      break;
    }
  }

  if (headerZeroBased < 0) {
    console.log(`Section "${MONTH}" not found in ${TAB} — nothing to delete`);
    return;
  }

  const startIndex = headerZeroBased > 0 ? headerZeroBased - 1 : headerZeroBased;
  const rowsToDelete = nextSectionZeroBased - startIndex;
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex, endIndex: nextSectionZeroBased },
        },
      }],
    },
  });
  console.log(`Deleted ${rowsToDelete} rows (separator + section "${MONTH}") from ${TAB}`);
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
