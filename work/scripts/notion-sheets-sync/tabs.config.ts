// Static configuration for tab resolution.
//
// By default the tool runs in DYNAMIC mode: it scans every Notion task,
// collects the distinct Assignee/Follower names, derives a tab name for
// each, and keeps the ones whose derived name actually matches a tab that
// already exists in the target Sheet. Add/remove a tab in the Sheet and
// the roster updates on the next run — no code change needed.
//
// If you want to restrict the sync to a specific set of people (e.g. while
// debugging or while a teammate is offboarding), list their exact Notion
// display names below. A non-empty `assignees` array switches off dynamic
// discovery — the tool syncs only the names listed here.

export const assignees: string[] = [
  // "Đoàn Minh Đăng",
];

// Escape hatch for the rare case where deriveTabName() produces the wrong
// label for someone (e.g. two people share a derived tab name, or the
// sheet tab is titled differently from what the rule would produce).
// Key = the exact Notion display name; value = the sheet tab name to use.
export const overrides: Record<string, string> = {
  "Trọng Hiếu Nguyễn": "HieuNT",
  "Tuấn Dương Nguyễn": "DuongNT",
  "Bách Nguyễn Hiền": "BachNH",
  "Tuấn Vũ": "TuanVM",
};
