import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "./src/config.ts";
import { fetchAllPages, filterByAssignee } from "./src/notion/client.ts";
import { readMembers } from "./src/util/members.ts";
import { titleOf } from "./src/notion/fields.ts";
import { overrides } from "./tabs.config.ts";

loadDotenv({ path: resolve(import.meta.dirname, "../../../.token.env") });

const KPI_SPREADSHEET_ID = "1A2LA-7IQAvegd2lzWf2IFCJ4G2_haghnWwTA2wyMxIg";
const TARGET_DEV = process.argv[2];
const KPI_MONTH_LABEL = "3/26";
const TARGET_MONTH_LABEL = "3/2026";

interface KpiSourceConfig {
  tabName: string;
  range: string;
  monthColIndex: number;
  taskColIndex: number;
  pointColIndex: number;
  assigneeColIndex: number;
}

const KPI_SOURCE_BY_ROLE: Record<string, KpiSourceConfig> = {
  developer: { tabName: "KPI Dev Team - 2026", range: "A1:G15000", monthColIndex: 0, taskColIndex: 1, pointColIndex: 4, assigneeColIndex: 6 },
  sublead: { tabName: "KPI Dev Team - 2026", range: "A1:G15000", monthColIndex: 0, taskColIndex: 1, pointColIndex: 4, assigneeColIndex: 6 },
  po: { tabName: "BA Team - 2023-26", range: "A5071:O7000", monthColIndex: 0, taskColIndex: 1, pointColIndex: 4, assigneeColIndex: 9 },
  tester: { tabName: "KPI Dev Team - 2026", range: "A1:I15000", monthColIndex: 0, taskColIndex: 1, pointColIndex: 4, assigneeColIndex: 8 },
};

if (!TARGET_DEV) { console.error("Usage: tsx check-march-kpi.ts <DevTab>"); process.exit(1); }

function normalize(s: string): string { return s.trim().replace(/\s+/g, " ").toLowerCase(); }

async function main() {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });

  const members = await readMembers();
  const member = members.find((m) => m.tabName === TARGET_DEV);
  if (!member) throw new Error(`No member with tab "${TARGET_DEV}"`);
  const kpiDevName = member.kpiName?.trim() || member.tabName;
  const source = KPI_SOURCE_BY_ROLE[member.role.trim().toLowerCase()];
  if (!source) throw new Error(`No KPI source configured for role "${member.role}"`);
  console.log(`Target: ${member.tabName} (${member.fullName}, ${member.role}) — KPI tab: "${source.tabName}", name: ${kpiDevName}`);

  const kpiResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: KPI_SPREADSHEET_ID,
    range: `${source.tabName}!${source.range}`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const kpiRows = kpiResp.data.values ?? [];
  const rangeStartRow = Number(source.range.match(/A(\d+):/)?.[1] ?? "1");
  const kpiTasks: { name: string; points: number; rowIndex: number }[] = [];
  for (let i = 0; i < kpiRows.length; i++) {
    const row = kpiRows[i] ?? [];
    if ((row[source.monthColIndex] ?? "").toString().trim() !== KPI_MONTH_LABEL) continue;
    if ((row[source.assigneeColIndex] ?? "").toString().trim() !== kpiDevName) continue;
    const name = (row[source.taskColIndex] ?? "").toString().trim();
    const points = Number((row[source.pointColIndex] ?? "").toString().replace(/,/g, "")) || 0;
    if (!name || points <= 0) continue;
    kpiTasks.push({ name, points, rowIndex: rangeStartRow + i });
  }
  const kpiTotal = kpiTasks.reduce((sum, task) => sum + task.points, 0);
  console.log(`\nKPI 3/2026: ${kpiTasks.length} tasks, ${kpiTotal} pts`);

  const sectionResp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: appConfig.googleSheetsId,
    range: `${TARGET_DEV}!A:G`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = sectionResp.data.values ?? [];
  const sectionTasks: { row: number; title: string; points: number }[] = [];
  let inSection = false;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] ?? "").toString().trim();
    if (cellA === TARGET_MONTH_LABEL) { inSection = true; continue; }
    if (!inSection) continue;
    if (cellA && cellA !== TARGET_MONTH_LABEL) break;
    const title = (rows[i]?.[1] ?? "").toString().trim();
    if (!title) continue;
    const points = Number((rows[i]?.[5] ?? "").toString().replace(/,/g, "")) || 0;
    sectionTasks.push({ row: i + 1, title, points });
  }
  const sectionTotal = sectionTasks.reduce((sum, task) => sum + task.points, 0);
  console.log(`Section 3/2026: ${sectionTasks.length} tasks, ${sectionTotal} pts`);

  const sectionKeys = new Set(sectionTasks.map((task) => normalize(task.title)));
  const kpiKeys = new Set(kpiTasks.map((task) => normalize(task.name)));

  const kpiNotInSection = kpiTasks.filter((task) => !sectionKeys.has(normalize(task.name)));
  const sectionNotInKpi = sectionTasks.filter((task) => !kpiKeys.has(normalize(task.title)));

  console.log("\n=== KPI tasks NOT in section ===");
  if (kpiNotInSection.length === 0) console.log("  (none)");
  for (const task of kpiNotInSection) console.log(`  ✗ "${task.name}" (${task.points} pts)`);

  console.log("\n=== Section tasks NOT in KPI (substitutes) ===");
  if (sectionNotInKpi.length === 0) console.log("  (none)");
  for (const task of sectionNotInKpi) console.log(`  ⚠ row ${task.row}: "${task.title}" (${task.points} pts)`);

  if (kpiNotInSection.length === 0) {
    console.log(`\n${kpiTotal === sectionTotal ? "✅" : "❌"} KPI=${kpiTotal} section=${sectionTotal}`);
    return;
  }

  console.log(`\n--- For unmatched: searching Notion (created ≥ 2026-02-01) ---`);
  const allPages = await fetchAllPages(appConfig.notionApiKey, appConfig.notionDatabaseId, {
    createdOnOrAfter: new Date("2026-02-01T00:00:00Z"),
  });
  const notionDisplayName = Object.entries(overrides).find(([, tab]) => tab === member.tabName)?.[0] ?? member.fullName;
  const myPages = filterByAssignee(allPages, notionDisplayName);
  console.log(`Notion assignee name resolved to: "${notionDisplayName}"`);
  const notionByKey = new Map<string, string[]>();
  for (const page of myPages) {
    const key = normalize(titleOf(page));
    const list = notionByKey.get(key) ?? [];
    list.push(`https://www.notion.so/${page.id.replace(/-/g, "")}`);
    notionByKey.set(key, list);
  }
  console.log(`Notion: ${myPages.length} pages assigned to ${member.fullName}`);

  console.log("\n=== KPI tasks not in section but exist in Notion (could be added) ===");
  let inNotion = 0;
  for (const task of kpiNotInSection) {
    const links = notionByKey.get(normalize(task.name));
    if (links) { console.log(`  + "${task.name}" (${task.points} pts) → ${links.join(", ")}`); inNotion++; }
  }
  if (inNotion === 0) console.log("  (none)");

  console.log("\n=== KPI tasks truly missing from Notion (need link) ===");
  let trulyMissing = 0;
  for (const task of kpiNotInSection) {
    if (!notionByKey.has(normalize(task.name))) {
      console.log(`  ✗ "${task.name}" (${task.points} pts)`);
      trulyMissing++;
    }
  }
  if (trulyMissing === 0) console.log("  (none)");
}

main().catch((cause) => { console.error("Fatal:", cause); process.exit(1); });
