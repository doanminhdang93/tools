import type { NotionPage } from "./notion/client.ts";
import {
  assigneeNamesOf,
  followerNamesOf,
  statusOf,
  createdTimeOf,
} from "./notion/fields.ts";
import { isSyncableStatus } from "./constants.ts";
import { normalizeNotionPageId } from "./notion/url.ts";

export const REVIEW_POINT_RATIO = 0.2;

export interface PageRowLocation {
  tabName: string;
  row: number;
}

export function pagesAsReviewer(
  allPages: NotionPage[],
  reviewerName: string,
  windowStart: Date,
  windowEnd: Date,
  pageIdsAlreadyInOtherSections: Set<string>,
): NotionPage[] {
  return allPages.filter((page) => {
    const followers = followerNamesOf(page);
    if (!followers.includes(reviewerName)) return false;

    const assignees = assigneeNamesOf(page);
    if (assignees.includes(reviewerName)) return false;

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

export function buildCrossTabReviewFormula(
  reviewerPages: NotionPage[],
  pageIdToRow: Map<string, PageRowLocation>,
  pointColumnLetter: string,
): string | null {
  if (reviewerPages.length === 0) return null;

  const cellRefs: string[] = [];
  for (const page of reviewerPages) {
    const normalizedId = normalizeNotionPageId(page.id);
    const location = pageIdToRow.get(normalizedId);
    if (!location) continue;
    cellRefs.push(`${location.tabName}!${pointColumnLetter}${location.row}`);
  }

  if (cellRefs.length === 0) return null;
  return `=ROUND(${REVIEW_POINT_RATIO}*(${cellRefs.join("+")}), 2)`;
}
