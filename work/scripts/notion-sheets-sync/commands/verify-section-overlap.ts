import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../src/config.ts";
import { COLUMN_INDEX } from "../src/constants.ts";
import { extractPageIdFromUrl } from "../src/notion/url.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const TAB = process.argv[2];
if (!TAB) {
  console.error("Usage: tsx commands/verify-section-overlap.ts <Tab>");
  process.exit(1);
}

interface SectionTasks {
  monthLabel: string;
  pageIds: Set<string>;
  rowsByPageId: Map<string, { row: number; title: string }>;
}

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: appConfig.googleSheetsId,
    range: `${TAB}!A1:O1000`,
  });
  const rows = (response.data.values ?? []) as string[][];

  const sections: SectionTasks[] = [];
  let current: SectionTasks | null = null;

  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] ?? "").toString().trim();
    const isMonthHeader = /^\d{1,2}\/\d{4}$/.test(cellA);
    if (isMonthHeader) {
      current = { monthLabel: cellA, pageIds: new Set(), rowsByPageId: new Map() };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const url = (rows[i]?.[COLUMN_INDEX.link] ?? "").toString().trim();
    const title = (rows[i]?.[COLUMN_INDEX.title] ?? "").toString().trim();
    if (!url) continue;
    const pageId = extractPageIdFromUrl(url);
    if (!pageId) continue;
    current.pageIds.add(pageId);
    current.rowsByPageId.set(pageId, { row: i + 1, title });
  }

  console.log(`\nTab: ${TAB}`);
  console.log(`Sections found: ${sections.map((section) => `${section.monthLabel}(${section.pageIds.size})`).join(", ")}\n`);

  let totalOverlaps = 0;
  for (let leftIndex = 0; leftIndex < sections.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < sections.length; rightIndex++) {
      const left = sections[leftIndex];
      const right = sections[rightIndex];
      const overlap: string[] = [];
      for (const pageId of left.pageIds) {
        if (right.pageIds.has(pageId)) overlap.push(pageId);
      }
      if (overlap.length === 0) continue;
      totalOverlaps += overlap.length;
      console.log(`OVERLAP ${left.monthLabel} ⇄ ${right.monthLabel}: ${overlap.length} task(s)`);
      for (const pageId of overlap) {
        const leftEntry = left.rowsByPageId.get(pageId)!;
        const rightEntry = right.rowsByPageId.get(pageId)!;
        console.log(`  ${pageId.slice(0, 8)}  L${leftEntry.row}=${left.monthLabel} | L${rightEntry.row}=${right.monthLabel} | ${leftEntry.title}`);
      }
    }
  }

  if (totalOverlaps === 0) {
    console.log("OK — no page ID appears in more than one section.");
  } else {
    console.log(`\nTotal overlapping page IDs: ${totalOverlaps}`);
  }
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
