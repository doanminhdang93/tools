# notion-sheets-sync

Syncs tasks from the `avadagroup` Notion "Tasks" database into a Google Sheet, with **one tab per Assignee** and **one month-section per tab**. By default only the **current month** is touched; pass `--month M/YYYY` to backfill a specific month.

- Design: [docs/design.md](docs/design.md)

## What gets synced

For each tab (one per person), the tool finds (or creates) the month section whose label matches the target month (the current month by default, or whatever `--month` specifies), and fills its task rows from Notion. A task shows up in a person's tab if they are listed as **Assignee** OR **Follower** on that Notion page.

Task rows hold these columns:

| Col | Header | Source (Notion) | Writable by sync? |
| --- | --- | --- | --- |
| A | Month & Stt | (empty on task rows; month label on section header) | yes — section header only |
| B | Task title | `product` (title) | yes |
| C | link | `https://www.notion.so/<page-id>` | yes |
| D | App | `Tag` (first value) | yes |
| E | Staging test | — | **preserved** (user-managed) |
| F | Type | — | **preserved** (user-managed) |
| G | Status | `Status` (mapped to Sheet dropdown form) | yes |
| H | Point | `Size Card` (select, numeric name) | yes |
| I | Money | — (Point × 45,000 VND on section header only) | yes — section header only |
| J | Note | — | **preserved** (user-managed) |
| K | Assignees | `Assignee` (people, comma-separated) | yes |
| L | Followers | `Follower` (people, comma-separated) | yes |

The section header row is recomputed every run via formulas: `Point = SUM(H<firstTask>:H<lastTask>)`, `Money = Point × 45000`. Row 1 headers are also written by the tool on every run (idempotent), so spreading the tool to a new tab requires no manual header setup.

Upsert matches by the 32-character Notion page id embedded in the `link` URL of column C — rows keep their position; user-owned columns (E, F, J) are kept verbatim.

## Setup

### 1. Install dependencies

```bash
cd work/scripts/notion-sheets-sync
npm install
```

### 2. Google Service Account

1. [Google Cloud Console](https://console.cloud.google.com/) → select or create a project
2. Enable **Google Sheets API**
3. Create a Service Account → Keys → Add key → JSON → download
4. Save the file as `service-account.json` inside this folder (gitignored)
5. Copy the SA email (`<name>@<project>.iam.gserviceaccount.com`)
6. Open the target Sheet → Share → paste the email → grant **Editor**

### 3. Notion integration

The `NOTION_API_KEY` in root `.token.env` must have read access to the Tasks database. In Notion: open the database → `...` → Connections → add the integration.

### 4. Root env vars

Already present in `/Users/dangdoan/Documents/workspace/Tools/.token.env`:

```bash
NOTION_API_KEY=<existing>
NOTION_DATABASE_ID=090d542c49d84c1d83370ace1cf52b56
GOOGLE_SHEETS_ID=1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=<absolute path to service-account.json>
SLACK_BOT_TOKEN=<existing>       # optional
NOTIFY_ON_ERROR_CHANNEL=         # optional — set a channel to enable alerts
```

### 5. Assignees → tabs

By default the tool is **fully dynamic**: it scans every Notion task, unions the unique names found in `Assignee` + `Follower`, derives a tab name for each via `deriveTabName(<name>)`, and keeps the ones whose derived name actually matches an existing tab in the target Sheet.

Add a teammate in Notion + create a tab with the matching derived name in the Sheet → the next run picks them up automatically. No code change.

Tab-name derivation (Vietnamese):

- `Đoàn Minh Đăng` → `DangDM`
- `Nguyễn Trọng Hiếu` → `HieuNT`

If you ever need to restrict the sync to a specific subset (e.g. while debugging), list the exact Notion display names in [tabs.config.ts](tabs.config.ts):

```ts
export const assignees: string[] = [
  "Đoàn Minh Đăng",
];
```

A non-empty `assignees` array switches off dynamic discovery — only the names listed are synced.

Use `overrides` (same file) if the derivation rule produces the wrong tab name for someone:

```ts
export const overrides: Record<string, string> = {
  "Some Notion Name": "CustomTabName",
};
```

**Each tab must already exist in the Sheet** with that exact name before running sync. The tool does not create tabs.

## Usage

Run everything from inside the tool folder:

```bash
cd /Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync
```

### Flags

| Flag / position | Meaning | Default |
| --- | --- | --- |
| `<tab>` (positional) or `--tab <tab>` | Which tab to sync | required unless `--all` |
| `--all` | Sync every tab in `tabs.config.ts` | off |
| `--month M/YYYY` | Sync this specific month instead of the system "now" | current month in Vietnam time |

### Common scenarios

```bash
# 1) Sync current month for one person (most common)
npm run sync -- DangDM

# 2) Sync current month for every configured tab (what cron runs every hour)
npm run sync -- --all

# 3) Backfill a specific past month for one tab
npm run sync -- DangDM --month 3/2026

# 4) Backfill a specific past month for everyone
npm run sync -- --all --month 12/2025

# 5) Explicit --tab flag form (equivalent to scenario 1)
npm run sync -- --tab DangDM
```

### How `--month` behaves

`--month M/YYYY` replaces the system-derived "current month". Everything downstream is identical to the default path:

- Candidate window = target month + previous month (in Vietnam time)
- Tasks already noted in other month sections of the sheet are skipped
- Matching rows keep their user-owned columns (Staging test / Type / Note) verbatim

> **Caution:** running `--month <past>` rewrites the target section — task ordering and totals are regenerated. Use it deliberately, not as part of routine cron.

### Invalid input

Bad `--month` input fails fast before any network call:

```bash
$ npm run sync -- DangDM --month abc
[...] ERROR --month must be M/YYYY (e.g. 3/2026), got: "abc"
$ echo $?
2
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Runtime failure (Notion/Sheets error, at least one tab failed) |
| `2` | Usage error (bad flag, unknown tab, malformed `--month`) |

## Cron (hourly)

A wrapper script `run-sync.sh` is shipped alongside the tool. It sources nvm, changes into the tool directory, and runs `npm run sync -- --all`. Using the wrapper keeps cron working even when you switch Node versions with `nvm use`.

Install the hourly cron entry:

```bash
( crontab -l 2>/dev/null; echo '0 * * * * /Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync/run-sync.sh >> /Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync/sync.log 2>&1' ) | crontab -
```

Verify:

```bash
crontab -l
```

Logs stream to `sync.log` in the tool folder (gitignored). Tail it after the next top-of-hour firing to confirm:

```bash
tail -f /Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync/sync.log
```

To uninstall:

```bash
crontab -l | grep -v run-sync.sh | crontab -
```

## Tests

```bash
npm test           # run vitest suite
npm run typecheck  # TypeScript strict check
```

## Project layout

Tests live next to the code they cover (`*.test.ts` alongside the module).

```text
work/scripts/notion-sheets-sync/
├── src/
│   ├── index.ts                # CLI entry (arg parse + --month handling + dispatch)
│   ├── sync.ts                 # syncTab orchestrator (one tab → one month-section)
│   ├── config.ts (+.test)      # Env loading + zod validation
│   ├── logger.ts               # Console + optional Slack notify
│   ├── constants.ts (+.test)   # Columns, POINT_VALUE_VND, Notion→Sheet status map
│   ├── notion/
│   │   ├── client.ts           # DB query + assignee filter
│   │   ├── fields.ts           # Typed accessors (title/status/tag/size-card/created)
│   │   └── url.ts (+.test)     # Build + parse Notion URLs; page-id extraction
│   ├── sheets/
│   │   ├── client.ts (+.test)  # Sheets API (read / writeRange / clearRows / style)
│   │   └── parser.ts (+.test)  # Split tab rows into month sections
│   └── util/
│       ├── month.ts (+.test)   # VN-time month labels, previousMonthLabel, monthLabelToDate
│       └── name.ts (+.test)    # Vietnamese-name → tab-name derivation
├── tabs.config.ts            # List of Notion assignees (tab names auto-derived)
├── service-account.json      # Google credential (gitignored)
├── docs/
│   └── design.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.sample
```

## Troubleshooting

- **`Tab "X" not in tabs.config.ts`** — add the assignee's exact Notion name to `assignees`, confirm the derived tab name matches the Sheet tab.
- **`403` on Google Sheets** — the target Sheet is not shared with the service-account email as Editor.
- **`404` on Notion database** — the integration is not connected to the Tasks database in Notion.
- **Slack alert not firing** — both `SLACK_BOT_TOKEN` and `NOTIFY_ON_ERROR_CHANNEL` must be set; the bot must be a member of the channel.
- **Totals look wrong** — the tool reads only the current month's tasks; if you moved a task to this month after it was created in another month, its `Created time` still points to the original month (this is Notion's behavior, not a bug here).
