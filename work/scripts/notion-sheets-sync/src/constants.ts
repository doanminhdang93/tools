export const POINT_VALUE_VND = 45_000;

export const TESTER_POINT_RATIO = 0.3;

export const REVIEW_ELIGIBLE_ROLES = new Set(["developer", "sublead"]);

export const PO_LAYOUT_TASK_TYPE_PO = "PO task";
export const PO_LAYOUT_TASK_TYPE_TESTER = "Tester task";

const PO_TIER_1_MAX_POINT = 136;
const PO_TIER_2_MAX_POINT = 188;
const PO_TIER_1_RATE = 22_000;
const PO_TIER_2_RATE = 30_000;
const PO_TIER_3_RATE = 35_000;
const PO_TIER_2_CHUNK = PO_TIER_2_MAX_POINT - PO_TIER_1_MAX_POINT;

export function parseRoles(roleField: string): string[] {
  return roleField
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

export function rolesIncludePo(roleField: string): boolean {
  return parseRoles(roleField).includes("po");
}

const LOW_RATE_ROLES = new Set(["po", "designer", "marketer"]);
const TIERED_ROLES = new Set(["po", "designer", "marketer"]);

export function pointRateForRole(role: string): number {
  const normalizedRole = role.trim().toLowerCase();
  if (LOW_RATE_ROLES.has(normalizedRole)) return 22_000;
  return 45_000;
}

export function isTieredRole(role: string): boolean {
  return TIERED_ROLES.has(role.trim().toLowerCase());
}

export function tieredMoneyForPoints(points: number): number {
  if (points < PO_TIER_1_MAX_POINT) return points * PO_TIER_1_RATE;
  if (points < PO_TIER_2_MAX_POINT) {
    return PO_TIER_1_MAX_POINT * PO_TIER_1_RATE + (points - PO_TIER_1_MAX_POINT) * PO_TIER_2_RATE;
  }
  return (
    PO_TIER_1_MAX_POINT * PO_TIER_1_RATE
    + PO_TIER_2_CHUNK * PO_TIER_2_RATE
    + (points - PO_TIER_2_MAX_POINT) * PO_TIER_3_RATE
  );
}

function tieredPointSheetFormula(pointExpression: string): string {
  const tier1Cap = `${PO_TIER_1_MAX_POINT}*${PO_TIER_1_RATE}`;
  const tier2Chunk = `${PO_TIER_2_CHUNK}*${PO_TIER_2_RATE}`;
  return (
    `IF(${pointExpression}<${PO_TIER_1_MAX_POINT},`
      + `${pointExpression}*${PO_TIER_1_RATE},`
      + `IF(${pointExpression}<${PO_TIER_2_MAX_POINT},`
        + `${tier1Cap}+(${pointExpression}-${PO_TIER_1_MAX_POINT})*${PO_TIER_2_RATE},`
        + `${tier1Cap}+${tier2Chunk}+(${pointExpression}-${PO_TIER_2_MAX_POINT})*${PO_TIER_3_RATE}`
      + `)`
    + `)`
  );
}

export interface TesterTaskRange {
  firstTaskRow: number;
  lastTaskRow: number;
}

export function moneyFormulaForRole(
  role: string,
  pointCol: string,
  headerRowOneBased: number,
  testerTaskRange?: TesterTaskRange,
): string {
  const pointRate = pointRateForRole(role);
  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === "tester") {
    if (!testerTaskRange) {
      return `=${pointCol}${headerRowOneBased}*${TESTER_POINT_RATIO}*${pointRate}`;
    }
    return testerMoneyFormula(pointCol, testerTaskRange);
  }
  if (normalizedRole === "sublead") {
    const reviewCol = columnLetter(COLUMN_INDEX.reviewPoint);
    return `=(${pointCol}${headerRowOneBased}+${reviewCol}${headerRowOneBased})*${pointRate}`;
  }
  if (normalizedRole === "designer" || normalizedRole === "marketer") {
    const pointCell = `${pointCol}${headerRowOneBased}`;
    return `=${tieredPointSheetFormula(pointCell)}`;
  }
  return `=${pointCol}${headerRowOneBased}*${pointRate}`;
}

function testerMoneyFormula(pointCol: string, range: TesterTaskRange): string {
  const assigneesCol = columnLetter(COLUMN_INDEX.assignees);
  const pointRange = `${pointCol}${range.firstTaskRow}:${pointCol}${range.lastTaskRow}`;
  const assigneesRange = `${assigneesCol}${range.firstTaskRow}:${assigneesCol}${range.lastTaskRow}`;
  const coassigneePoints = `SUMIF(${assigneesRange},"*,*",${pointRange})`;
  const solePoints = `(SUM(${pointRange})-${coassigneePoints})`;
  return `=${solePoints}*${POINT_VALUE_VND}+${coassigneePoints}*${TESTER_POINT_RATIO}*${POINT_VALUE_VND}`;
}

export const SHEET_COLUMN_HEADERS = [
  "Month & Stt",
  "Task title",
  "link",
  "App",
  "Status",
  "Point",
  "Review point",
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
  reviewPoint: 6,
  money: 7,
  assignees: 8,
  followers: 9,
  note: 10,
} as const;

export const USER_OWNED_COLUMNS = [COLUMN_INDEX.note] as const;

export const PO_LAYOUT_HEADERS = [
  "Month & Stt",
  "Task title",
  "link",
  "App",
  "Status",
  "Task type",
  "BA Point",
  "Test point",
  "Money",
  "Assignees",
  "Followers",
  "Note",
] as const;

export const PO_LAYOUT_COLUMN_COUNT = PO_LAYOUT_HEADERS.length;

export const PO_LAYOUT_COLUMN_INDEX = {
  month: 0,
  title: 1,
  link: 2,
  app: 3,
  status: 4,
  taskType: 5,
  baPoint: 6,
  testPoint: 7,
  money: 8,
  assignees: 9,
  followers: 10,
  note: 11,
} as const;

export const PO_LAYOUT_USER_OWNED_COLUMNS = [
  PO_LAYOUT_COLUMN_INDEX.taskType,
  PO_LAYOUT_COLUMN_INDEX.note,
] as const;

export function poLayoutMoneyFormula(
  headerRowOneBased: number,
  firstTaskRow: number,
  lastTaskRow: number,
): string {
  const taskTypeCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.taskType);
  const baCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.baPoint);
  const testCol = columnLetter(PO_LAYOUT_COLUMN_INDEX.testPoint);
  const taskTypeRange = `${taskTypeCol}${firstTaskRow}:${taskTypeCol}${lastTaskRow}`;
  const baRange = `${baCol}${firstTaskRow}:${baCol}${lastTaskRow}`;
  const testRange = `${testCol}${firstTaskRow}:${testCol}${lastTaskRow}`;
  void headerRowOneBased;

  const poSum = `SUMIF(${taskTypeRange},"${PO_LAYOUT_TASK_TYPE_PO}",${baRange})`;
  const testerSum = `SUMIF(${taskTypeRange},"${PO_LAYOUT_TASK_TYPE_TESTER}",${testRange})`;
  const poPart = tieredPointSheetFormula(poSum);
  const testerPart = `${testerSum}*${TESTER_POINT_RATIO}*${POINT_VALUE_VND}`;
  return `=${poPart}+${testerPart}`;
}

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
  const sheetApp = SHEET_APP_BY_LOWERCASE_NOTION_TAG.get(
    notionTag.trim().toLowerCase(),
  );
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
  "Review Done": "Review Done",
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
