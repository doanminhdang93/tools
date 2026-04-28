export const POINT_VALUE_VND = 45_000;

export const TESTER_POINT_RATIO = 0.3;

export function pointRateForRole(role: string): number {
  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === "po" || normalizedRole === "designer") return 22_000;
  return 45_000;
}

export function moneyFormulaForRole(role: string, pointCol: string, headerRowOneBased: number): string {
  const pointRate = pointRateForRole(role);
  const isTester = role.trim().toLowerCase() === "tester";
  return isTester
    ? `=${pointCol}${headerRowOneBased}*${TESTER_POINT_RATIO}*${pointRate}`
    : `=${pointCol}${headerRowOneBased}*${pointRate}`;
}

export const SHEET_COLUMN_HEADERS = [
  "Month & Stt",
  "Task title",
  "link",
  "App",
  "Status",
  "Point",
  "Money",
  "Assignees",
  "Followers",
  "Note",
] as const;

export const SHEET_COLUMN_COUNT = SHEET_COLUMN_HEADERS.length;

export const COLUMN_INDEX = {
  month: 0,
  title: 1,
  link: 2,
  app: 3,
  status: 4,
  point: 5,
  money: 6,
  assignees: 7,
  followers: 8,
  note: 9,
} as const;

export const USER_OWNED_COLUMNS = [COLUMN_INDEX.note] as const;

export function columnLetter(zeroBasedIndex: number): string {
  return String.fromCharCode(65 + zeroBasedIndex);
}

// Notion Tag (first value) → Sheet "App" column value.
// Notion names are spelled out; the sheet uses short codes.
const NOTION_TAG_TO_SHEET_APP = {
  "Checkout Upsell": "CKU",
} as const;

const SHEET_APP_BY_LOWERCASE_NOTION_TAG = new Map<string, string>(
  Object.entries(NOTION_TAG_TO_SHEET_APP).map(([notionTag, sheetApp]) => [
    notionTag.trim().toLowerCase(),
    sheetApp,
  ]),
);

export function toSheetApp(notionTag: string): string {
  const sheetApp = SHEET_APP_BY_LOWERCASE_NOTION_TAG.get(notionTag.trim().toLowerCase());
  return sheetApp ?? notionTag;
}

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
