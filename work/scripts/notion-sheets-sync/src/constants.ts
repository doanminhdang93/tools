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

export const SYNCABLE_STATUSES = [
  "Done",
  "Testing Pro",
  "Testing",
  "Waiting To Test",
  "Wait to Review",
  "Reviewing",
  "Live",
] as const;

const SYNCABLE_STATUSES_LOWERCASED = new Set<string>(
  SYNCABLE_STATUSES.map((status) => status.toLowerCase()),
);

export function isSyncableStatus(status: string): boolean {
  return SYNCABLE_STATUSES_LOWERCASED.has(status.trim().toLowerCase());
}
