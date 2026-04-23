export const POINT_VALUE_VND = 45_000;

export const SHEET_COLUMN_HEADERS = [
  "Month & Stt",
  "Task title",
  "link",
  "App",
  "Staging test",
  "Type",
  "Status",
  "Point",
  "Money",
  "Note",
] as const;

export const SHEET_COLUMN_COUNT = SHEET_COLUMN_HEADERS.length;

export const COLUMN_INDEX = {
  month: 0,
  title: 1,
  link: 2,
  app: 3,
  stagingTest: 4,
  type: 5,
  status: 6,
  point: 7,
  money: 8,
  note: 9,
} as const;

export const USER_OWNED_COLUMNS = [
  COLUMN_INDEX.stagingTest,
  COLUMN_INDEX.type,
  COLUMN_INDEX.note,
] as const;

export const MONTH_HEADER_PATTERN = /^(\d{1,2})\/(\d{4})$/;

// Canonical Notion Status → canonical Sheet dropdown value.
// Key = exactly what Notion reports (from DB schema).
// Value = exactly what the target Sheet's Status column dropdown accepts.
// Notion and Sheet disagree on casing for a couple of entries, and
// "Wait To Live" in Notion is shown as "Live" in the Sheet, so an explicit
// map keeps both sides honest.
const NOTION_TO_SHEET_STATUS = {
  Done: "Done",
  "Testing Pro": "Testing Pro",
  Testing: "Testing",
  "Waiting To Test": "Waiting To Test",
  "Wait To Review": "Wait to Review",
  Reviewing: "Reviewing",
  "Wait To Live": "Live",
} as const;

export const SYNCABLE_STATUSES = Object.keys(NOTION_TO_SHEET_STATUS);

const SHEET_STATUS_BY_LOWERCASE_NOTION = new Map<string, string>(
  Object.entries(NOTION_TO_SHEET_STATUS).map(([notionStatus, sheetStatus]) => [
    notionStatus.trim().toLowerCase(),
    sheetStatus,
  ]),
);

export function isSyncableStatus(status: string): boolean {
  return SHEET_STATUS_BY_LOWERCASE_NOTION.has(status.trim().toLowerCase());
}

export function toSheetStatus(notionStatus: string): string {
  const sheetStatus = SHEET_STATUS_BY_LOWERCASE_NOTION.get(
    notionStatus.trim().toLowerCase(),
  );
  return sheetStatus ?? notionStatus;
}
