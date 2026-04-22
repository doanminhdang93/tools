# Notion → Google Sheets Sync — Design

**Date:** 2026-04-22
**Status:** Implemented (v2 — section-based layout)
**Location:** `work/scripts/notion-sheets-sync/`

## Goal

Fill, per run, the **current-month section** of a per-Assignee tab in a shared Google Sheet from the `avadagroup` Notion "Tasks" database. Previous months are immutable. User-managed columns (Staging test, Type, Note) are preserved across syncs.

## Source

- **Workspace:** `avadagroup`
- **Database ID:** `090d542c49d84c1d83370ace1cf52b56` (title: "Tasks")
- Properties read by the tool:
  - `product` (title) — task title
  - `Status` (status) — status value
  - `Tag` (multi_select, first value) — "App" code (PPU, BS, FG, …)
  - `Size Card` (select, numeric name) — story points
  - `Assignee` (people) — filter
  - `Created time` (created_time) — month grouping

Note: `Story Point` property exists but is barely populated (1 value across 419 sample pages). We use `Size Card` for points per explicit user confirmation.

## Destination

- **Sheet:** `https://docs.google.com/spreadsheets/d/1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w/edit`
- **Tabs:** one per Assignee, pre-created by the user. First supported tab: `DangDM`.
- **Auth:** Google Service Account JSON (gitignored), Sheet shared with SA email as Editor.

## Layout

Each tab has a fixed 10-column header at row 1:

```text
A = Month & Stt  B = Task title  C = link  D = App  E = Staging test
F = Type  G = Status  H = Point  I = Money  J = Note
```

Content below row 1 is a sequence of month sections, each shaped as:

```text
<blank row>                                    (separator before 2nd+ section)
<month header row>   A="M/YYYY", H=total pts, I=total money, others empty
<task rows>          A="", B=title, C=notion URL, D=first Tag,
                     E/F/J user-owned, G=status, H=size card, I=""
```

## Ownership of columns

| Column | Source | On task rows | On section headers |
| ------ | ------ | ------------ | ------------------ |
| A | — / month | empty | `M/YYYY` |
| B | `product` | written | empty |
| C | notion URL | written | empty |
| D | `Tag[0]` | written | empty |
| E | user-managed | **preserved** | empty |
| F | user-managed | **preserved** | empty |
| G | `Status` | written | empty |
| H | `Size Card` | written | sum of task points |
| I | derived | empty | `H × 45,000` |
| J | user-managed | **preserved** | empty |

`POINT_VALUE_VND = 45000` is a fixed constant.

## Upsert strategy

- Each task row carries the Notion page's URL in column C (`https://www.notion.so/<32-hex-id>`).
- During sync, the tool extracts the 32-char id from every existing row's URL in the current section and builds `Map<pageId, existingRow>`.
- For each Notion task in the current month:
  - If `existingRow` exists → copy E, F, J from the existing row into the new row and update B, C, D, G, H.
  - Otherwise → append with empty E, F, J.
- Rows are written back in ascending `Created time` order.

## Section management

- **Current month label** = `UTC.getMonth()+1 + "/" + UTC.getFullYear()`.
- If a section with that label already exists, the tool writes over the header row + task rows, then clears any trailing rows from the old section that are no longer needed.
- If no matching section exists, the tool appends at the end of the tab after one blank separator row.

Only the current-month section is ever written; all earlier sections stay untouched.

## CLI

```bash
npm run sync -- DangDM        # positional → one tab
npm run sync -- --tab DangDM  # explicit flag → one tab
npm run sync -- --all         # iterate every tab in tabs.config.ts
```

Exit codes: `0` ok, `1` runtime failure (any tab), `2` usage error.

## Tabs config

File `tabs.config.ts` holds a list of Notion assignee full names. Tab names are auto-derived:

- `Đoàn Minh Đăng` → `DangDM`
- `Nguyễn Trọng Hiếu` → `HieuNT`

Collisions can be handled via a manual `overrides` map (not needed today).

## Cron

Hourly system `crontab`:

```cron
0 * * * * cd <abs path> && /usr/local/bin/npm run sync -- --all >> sync.log 2>&1
```

## Error handling

- Top-level catch in `index.ts` → stack-trace log, exit 1.
- Per-tab failures in `--all` mode are collected; remaining tabs still attempt.
- `notifyFailure` posts a Slack message if and only if both `SLACK_BOT_TOKEN` and `NOTIFY_ON_ERROR_CHANNEL` are set.

## Out of scope

- Two-way sync (Sheets → Notion).
- Backfilling historical sections.
- Auto-creation of tabs (tabs must pre-exist).
- Deletion propagation (tasks removed from Notion remain in Sheet rows below the current month).
- Computing a "Stt" number per task within Column A.

## Implementation layout

Source lives in `src/` and is grouped by domain:

- `src/index.ts` — CLI entry
- `src/sync.ts` — orchestrator (`syncTab`)
- `src/config.ts`, `src/logger.ts`, `src/constants.ts` — infrastructure
- `src/notion/` — Notion integration (`client`, `fields`, `url`)
- `src/sheets/` — Google Sheets integration (`client`, `parser`)
- `src/util/` — reusable helpers (`month`, `name`)

Tests are co-located: `foo.ts` is paired with `foo.test.ts` in the same folder. Vitest picks them up via `src/**/*.test.ts` in `vitest.config.ts`.

See [README.md](../README.md) § Project layout for the full tree.
