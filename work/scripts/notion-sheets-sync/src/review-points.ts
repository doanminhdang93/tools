import type { NotionPage } from "./notion/client.ts";
import {
  assigneeNamesOf,
  followerNamesOf,
  statusOf,
  createdTimeOf,
  storyPointNumberOf,
  sizeCardNumberOf,
} from "./notion/fields.ts";
import { isSyncableStatus } from "./constants.ts";
import { normalizeNotionPageId } from "./notion/url.ts";

export const REVIEW_POINT_RATIO = 0.2;

const LEGACY_REVIEW_NOTE_PATTERN = /^Review \(Sublead\)/;

export function isLegacyReviewNote(note: string): boolean {
  return LEGACY_REVIEW_NOTE_PATTERN.test(note);
}

export function discountedReviewPoint(originalPoint: number): number {
  return Math.round(originalPoint * REVIEW_POINT_RATIO * 100) / 100;
}

export function originalTaskPoint(page: NotionPage): number {
  return storyPointNumberOf(page) || sizeCardNumberOf(page);
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

export function totalReviewPoints(reviewerPages: NotionPage[]): number {
  const sumHundredths = reviewerPages.reduce((accumulator, page) => {
    return accumulator + Math.round(originalTaskPoint(page) * REVIEW_POINT_RATIO * 100);
  }, 0);
  return sumHundredths / 100;
}

export interface PageRowLocation {
  tabName: string;
  row: number;
}

export function buildReviewPointFormula(
  reviewerPages: NotionPage[],
  pageIdToRow: Map<string, PageRowLocation>,
  pointColumnLetter: string,
): string | null {
  if (reviewerPages.length === 0) return null;

  const cellRefs: string[] = [];
  let unmappedFallbackPoints = 0;

  for (const page of reviewerPages) {
    const normalizedId = page.id.replace(/-/g, "").toLowerCase();
    const location = pageIdToRow.get(normalizedId);
    if (location) {
      cellRefs.push(`${location.tabName}!${pointColumnLetter}${location.row}`);
    } else {
      unmappedFallbackPoints += originalTaskPoint(page);
    }
  }

  if (cellRefs.length === 0 && unmappedFallbackPoints === 0) return null;

  const parts: string[] = [];
  if (cellRefs.length > 0) parts.push(cellRefs.join("+"));
  if (unmappedFallbackPoints > 0) parts.push(String(unmappedFallbackPoints));
  return `=ROUND(${REVIEW_POINT_RATIO}*(${parts.join("+")}), 2)`;
}
