import type { NotionPage } from "./notion/client.ts";
import {
  assigneeNamesOf,
  followerNamesOf,
  statusOf,
  createdTimeOf,
  storyPointNumberOf,
  sizeCardNumberOf,
  titleOf,
  tagNamesOf,
} from "./notion/fields.ts";
import {
  isSyncableStatus,
  COLUMN_INDEX,
  SHEET_COLUMN_COUNT,
  toSheetApp,
  toSheetStatus,
} from "./constants.ts";
import { buildNotionUrl, normalizeNotionPageId } from "./notion/url.ts";

export const SUBLEAD_REVIEW_RATIO = 0.2;
const SUBLEAD_REVIEW_NOTE_PATTERN = /^Review \(Sublead\)/;

export function subleadReviewPoint(originalPoint: number): number {
  return Math.round(originalPoint * SUBLEAD_REVIEW_RATIO * 100) / 100;
}

export function buildSubleadReviewNote(originalPoint: number): string {
  return `Review (Sublead) • 20% × ${originalPoint}`;
}

export function isSubleadReviewNote(note: string): boolean {
  return SUBLEAD_REVIEW_NOTE_PATTERN.test(note);
}

export function originalTaskPoint(page: NotionPage): number {
  return storyPointNumberOf(page) || sizeCardNumberOf(page);
}

export function pagesAsSubleadFollower(
  allPages: NotionPage[],
  subleadName: string,
  windowStart: Date,
  windowEnd: Date,
  pageIdsAlreadyInOtherSections: Set<string>,
): NotionPage[] {
  return allPages.filter((page) => {
    const followers = followerNamesOf(page);
    if (!followers.includes(subleadName)) return false;

    const assignees = assigneeNamesOf(page);
    if (assignees.includes(subleadName)) return false;

    if (!isSyncableStatus(statusOf(page))) return false;

    const createdIso = createdTimeOf(page);
    if (!createdIso) return false;
    const createdAt = new Date(createdIso);
    if (createdAt < windowStart || createdAt > windowEnd) return false;

    const normalizedPageId = normalizeNotionPageId(page.id);
    if (pageIdsAlreadyInOtherSections.has(normalizedPageId)) return false;

    return true;
  });
}

export function buildSubleadReviewRow(page: NotionPage, originalPoint: number): string[] {
  const row = new Array<string>(SHEET_COLUMN_COUNT).fill("");
  row[COLUMN_INDEX.title] = titleOf(page);
  row[COLUMN_INDEX.link] = buildNotionUrl(page.id);
  row[COLUMN_INDEX.app] = tagNamesOf(page).map(toSheetApp).join(", ");
  row[COLUMN_INDEX.status] = toSheetStatus(statusOf(page));
  row[COLUMN_INDEX.point] = String(subleadReviewPoint(originalPoint));
  row[COLUMN_INDEX.assignees] = assigneeNamesOf(page).join(", ");
  row[COLUMN_INDEX.followers] = followerNamesOf(page).join(", ");
  row[COLUMN_INDEX.note] = buildSubleadReviewNote(originalPoint);
  return row;
}
