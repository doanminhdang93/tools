import { google } from "googleapis";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.ts";

export interface Member {
  tabName: string;
  fullName: string;
  role: string;
  team: string;
  apps: string;
  kpiName: string;
}

const MEMBERS_TAB = "Members";

export async function readMembers(): Promise<Member[]> {
  const appConfig = loadConfig();
  const googleAuth = new google.auth.GoogleAuth({
    credentials: JSON.parse(readFileSync(resolve(appConfig.googleServiceAccountKeyFile), "utf8")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: appConfig.googleSheetsId,
    range: `${MEMBERS_TAB}!A2:F`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = response.data.values ?? [];
  const members: Member[] = [];
  for (const row of rows) {
    const tabName = (row?.[0] ?? "").toString().trim();
    const fullName = (row?.[1] ?? "").toString().trim();
    if (!tabName || !fullName) continue;
    members.push({
      tabName,
      fullName,
      role: (row?.[2] ?? "").toString().trim(),
      team: (row?.[3] ?? "").toString().trim(),
      apps: (row?.[4] ?? "").toString().trim(),
      kpiName: (row?.[5] ?? "").toString().trim() || tabName,
    });
  }
  return members;
}
