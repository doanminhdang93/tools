import { collectInvolvedPeopleNames, type NotionPage } from "./notion/client.ts";
import type { SheetsClient } from "./sheets/client.ts";
import { deriveTabName } from "./util/name.ts";

export interface TabEntry {
  tabName: string;
  notionAssigneeName: string;
}

export interface ResolveTabsArgs {
  explicitAssignees: readonly string[];
  overrides: Readonly<Record<string, string>>;
  allPages: NotionPage[];
  sheets: SheetsClient;
}

export async function resolveTargetTabs(args: ResolveTabsArgs): Promise<TabEntry[]> {
  const { explicitAssignees, overrides, allPages, sheets } = args;

  if (explicitAssignees.length > 0) {
    return explicitAssignees.map((notionAssigneeName) => ({
      notionAssigneeName,
      tabName: overrides[notionAssigneeName] ?? deriveTabName(notionAssigneeName),
    }));
  }

  const involvedNames = collectInvolvedPeopleNames(allPages);
  const existingTabNames = new Set(await sheets.listTabNames());

  const matched: TabEntry[] = [];
  for (const notionAssigneeName of involvedNames) {
    const tabName = overrides[notionAssigneeName] ?? deriveTabName(notionAssigneeName);
    if (existingTabNames.has(tabName)) {
      matched.push({ notionAssigneeName, tabName });
    }
  }

  matched.sort((left, right) => left.tabName.localeCompare(right.tabName));
  return matched;
}
