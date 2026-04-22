import { deriveTabName } from "./src/util/name.ts";

export const assignees: string[] = [
  "Đoàn Minh Đăng",
  // Add more as teammates are onboarded:
  // "Nguyễn Trọng Hiếu",
];

export const overrides: Record<string, string> = {
  // Use only when two assignees derive the same tab name.
  // "Notion Full Name": "CustomTabName",
};

export interface TabEntry {
  tabName: string;
  notionAssigneeName: string;
}

export function resolveTabs(): TabEntry[] {
  return assignees.map((notionAssigneeName) => ({
    notionAssigneeName,
    tabName: overrides[notionAssigneeName] ?? deriveTabName(notionAssigneeName),
  }));
}
