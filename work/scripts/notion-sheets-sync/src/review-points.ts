import type { NotionPage } from "./notion/client.ts";
import {
  assigneeNamesOf,
  followerNamesOf,
  statusOf,
  createdTimeOf,
} from "./notion/fields.ts";
import { isSyncableStatus } from "./constants.ts";
import { normalizeNotionPageId } from "./notion/url.ts";

const DEVELOPER_ROLE = "developer";

export interface MemberRoleInfo {
  tabName: string;
  role: string;
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

export function relatedDevTabsForReviewer(
  reviewerPages: NotionPage[],
  memberByNotionName: Map<string, MemberRoleInfo>,
): Set<string> {
  const tabs = new Set<string>();
  for (const page of reviewerPages) {
    for (const notionName of assigneeNamesOf(page)) {
      const member = memberByNotionName.get(notionName);
      if (!member) continue;
      if (member.role.trim().toLowerCase() !== DEVELOPER_ROLE) continue;
      tabs.add(member.tabName);
    }
  }
  return tabs;
}

export function buildSubleadReviewFormulaFromDevTotals(
  relatedDevTabs: Iterable<string>,
  tabHeaderRowMap: Map<string, number>,
  reviewColumnLetter: string,
): string | null {
  const cellRefs: string[] = [];
  const seen = new Set<string>();
  for (const tabName of relatedDevTabs) {
    if (seen.has(tabName)) continue;
    seen.add(tabName);
    const headerRow = tabHeaderRowMap.get(tabName);
    if (!headerRow) continue;
    cellRefs.push(`${tabName}!${reviewColumnLetter}${headerRow}`);
  }
  if (cellRefs.length === 0) return null;
  return `=ROUND(${cellRefs.join("+")}, 2)`;
}
