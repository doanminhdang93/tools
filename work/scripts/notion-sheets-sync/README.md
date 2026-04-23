# notion-sheets-sync

Syncs tasks from the `avadagroup` Notion "Tasks" database into a Google Sheet, with **one tab per Assignee** and **one month-section per tab**. Only the **current month** is touched on each run — previous months are preserved.

- Design: [docs/design.md](docs/design.md)

## What gets synced

For each configured Assignee, the tool finds (or creates) the month section whose label matches the current month (e.g. `4/2026`), and fills its task rows from Notion. Task rows hold these columns:

| Col | Header | Source (Notion) | Writable by sync? |
| --- | --- | --- | --- |
| A | Month & Stt | (empty on task rows; month label on section header) | yes — section header only |
| B | Task title | `product` (title) | yes |
| C | link | `https://www.notion.so/<page-id>` | yes |
| D | App | `Tag` (first value) | yes |
| E | Staging test | — | **preserved** (user-managed) |
| F | Type | — | **preserved** (user-managed) |
| G | Status | `Status` | yes |
| H | Point | `Size Card` (select, numeric name) | yes |
| I | Money | — (Point × 45,000 VND on section header only) | yes — section header only |
| J | Note | — | **preserved** (user-managed) |

The section header row is recomputed every run: `Point` = sum of all task points in the section, `Money` = `Point × 45,000`.

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

### 5. Configure assignees → tabs

Edit [tabs.config.ts](tabs.config.ts):

```ts
export const assignees: string[] = [
  "Đoàn Minh Đăng",
  // Add more as teammates are onboarded
];
```

Tab names are auto-derived from Vietnamese names:

- `Đoàn Minh Đăng` → `DangDM`
- `Nguyễn Trọng Hiếu` → `HieuNT`

**Each tab must already exist in the Sheet** with that exact name before running sync.

## Run

```bash
# Sync a single tab (positional)
npm run sync -- DangDM

# Equivalent, explicit flag
npm run sync -- --tab DangDM

# Sync every configured tab (used by cron)
npm run sync -- --all
```

Exit codes: `0` success · `1` runtime failure · `2` usage error.

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
npm test           # run vitest suite (32 tests)
npm run typecheck  # TypeScript strict check
```

## Project layout

Tests live next to the code they cover (`*.test.ts` alongside the module).

```text
work/scripts/notion-sheets-sync/
├── src/
│   ├── index.ts              # CLI entry (arg parse + dispatch)
│   ├── sync.ts               # syncTab orchestrator (current-month only)
│   ├── config.ts (+.test)    # Env loading + zod validation
│   ├── logger.ts             # Console + optional Slack notify
│   ├── constants.ts          # Column indices, POINT_VALUE_VND, SYNCABLE_STATUSES
│   ├── notion/
│   │   ├── client.ts         # DB query + assignee filter
│   │   ├── fields.ts         # Typed accessors (title/status/tag/size-card/created)
│   │   └── url.ts (+.test)   # Build + parse Notion URLs; page-id extraction
│   ├── sheets/
│   │   ├── client.ts (+.test) # Sheets API (read / writeRange / clearRows / style)
│   │   └── parser.ts (+.test) # Split tab rows into month sections
│   └── util/
│       ├── month.ts (+.test)  # Vietnam-time month labels + previousMonthLabel
│       └── name.ts (+.test)   # Vietnamese-name → tab-name derivation
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
