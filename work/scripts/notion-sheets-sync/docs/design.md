# Notion → Google Sheets Sync Tool — Design

**Date:** 2026-04-22
**Status:** Approved; ready for implementation
**Location:** `work/scripts/notion-sheets-sync/`

## Goal

Sync tasks from a Notion database to an existing Google Sheet, one-way (Notion → Sheets). Runs both manually and via cron (every 1 hour). Upsert by Notion page ID so manual formatting/charts in Sheets are preserved.

**Per-tab model:** the target Sheet has multiple tabs, one per Assignee. Each tab receives only tasks where the `Assignee` property matches that tab's owner. The CLI accepts a tab name as argument to sync a specific tab. This is a core requirement — the sync is always scoped to a single Assignee → single tab.

## Source

- **Workspace:** `avadagroup`
- **Database ID:** `090d542c49d84c1d83370ace1cf52b56` (title: "Tasks", 17 properties total)

### Properties to sync (8 of 17)

| Order | Property | Notion type | Sheet column |
| ----- | -------- | ----------- | ------------ |
| 1 | `Task ID` | unique_id | Task ID |
| 2 | `product` | title | Task |
| 3 | `Status` | status | Status |
| 4 | `Assignee` | people | Assignee |
| 5 | `Follower` | people | Follower |
| 6 | `Size Card` | select | Size Card |
| 7 | `Sprint` | relation | Sprint |
| 8 | `Created time` | created_time | Created time |

Dropped: `Release date`, `Time`, `Priority`, `Tag`, `Story Point`, `Description`, `Figma File`, `point`, `point 1`.

A hidden column `_notion_id` (Notion page ID) sits at position A for upsert matching. Visible headers start at column B.

## Destination

- **Sheet:** `https://docs.google.com/spreadsheets/d/1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w/edit`
- **Sheet ID:** `1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w`
- **Tabs:** one per Assignee. First tab to support: `DangDM`.
- **Auth:** Google Service Account (JSON key file, shared with target Sheet as Editor)

## CLI surface

```bash
# Sync a specific tab (Assignee)
npm run sync -- DangDM
npm run sync -- --tab DangDM

# Sync all configured tabs in one run (for cron)
npm run sync -- --all
```

The `--all` flag loops through every entry in `tabs.config.ts`. Cron uses `--all`. Manual runs typically target one tab.

## Tab configuration

File `tabs.config.ts` holds the list of Notion assignee full-names. Tab names are auto-derived (no manual mapping).

```ts
export const assignees: string[] = [
  "Đoàn Minh Đăng",
  // "Nguyễn Trọng Hiếu",  // add as teammates are onboarded
];
```

### Tab-name derivation

Rule (given Vietnamese name `Family Middle Given`):

1. Take the **given name** (last word) → remove Vietnamese diacritics (including `Đ`→`D`) → capitalize first letter → `Given`
2. Take the **initials** of all preceding words (family + middle) → remove diacritics → uppercase → `Initials`
3. Tab name = `Given + Initials`

Examples:

- `Đoàn Minh Đăng` → given=`Đăng`→`Dang`, initials=`ĐM`→`DM` → **`DangDM`**
- `Nguyễn Trọng Hiếu` → given=`Hiếu`→`Hieu`, initials=`NT` → **`HieuNT`**

Collisions (same derived name for two people) are expected to be rare; user will manually suffix `1`, `2` in the Sheet tab name and add the suffix to the override map:

```ts
// optional
export const overrides: Record<string, string> = {
  // "Notion Full Name": "DerivedNamePlusSuffix",
};
```

Filter logic: fetch all pages from Notion DB once per run; for each assignee, keep pages whose `Assignee` property includes a person with that exact `name` (full-name match, case-sensitive, diacritics preserved).

## Architecture

```text
work/scripts/notion-sheets-sync/
├── src/
│   ├── index.ts         # CLI entry — parse args, dispatch
│   ├── sync.ts          # Orchestrate for one tab: filter → diff → write
│   ├── notion.ts        # Paginated fetch of Notion DB
│   ├── sheets.ts        # Read/write Google Sheets, service account auth
│   ├── transform.ts     # Notion property → flat cell value per type
│   ├── config.ts        # Env loading + zod validation
│   └── logger.ts        # Console + optional Slack error notify
├── tabs.config.ts       # Tab → Assignee mapping
├── columns.config.ts    # Column order + header names
├── service-account.json # Gitignored
├── package.json
├── tsconfig.json
├── README.md
└── .env.sample
```

### Dependencies

- `@notionhq/client` — official Notion SDK
- `googleapis` — Google Sheets API
- `dotenv` — load root `.token.env`
- `zod` — validate env/config
- `tsx` — run TypeScript directly (dev/prod)

## Data flow (per tab)

1. **Load config** — read `.token.env` from repo root, validate with zod
2. **Fetch Notion** — paginate DB `query` endpoint until exhausted (done once, shared across tabs in `--all` mode)
3. **Filter by Assignee** — keep pages where `Assignee` contains a person with `name === tab.notionAssigneeName`
4. **Transform** — each page → row per `columns.config.ts`. Column A = Notion page ID.
5. **Read Sheet tab** — get column A + headers → `Map<notionId, rowIndex>`
6. **Diff & write**:
   - `updates` (ID exists) → batch update ranges
   - `appends` (ID new) → append at end of tab
   - (v1) Rows in Sheet but no longer in Notion → left alone
7. **Report** — log counts (fetched / filtered / updated / appended) per tab

## Upsert strategy rationale

Full overwrite was rejected — user wants to preserve conditional formatting, charts, and any manual annotations in the Sheet. Upsert by Notion page ID keeps row positions stable so references don't break.

## Cron

- System `crontab` for hourly `--all` runs
- Entry: `0 * * * * cd <abs-path> && npm run sync -- --all >> sync.log 2>&1`
- No long-running Node process (no `node-cron`)
- README documents both crontab and launchd (macOS) setup

## Env vars (added to root `.token.env`)

```bash
# Already present
NOTION_API_KEY=<set>
SLACK_BOT_TOKEN=<set>

# To add
NOTION_DATABASE_ID=090d542c49d84c1d83370ace1cf52b56
GOOGLE_SHEETS_ID=1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json
NOTIFY_ON_ERROR_CHANNEL=            # empty = no Slack
```

## Error handling

- Top-level try/catch in `index.ts` → log stack, exit 1
- Per-page transform errors: log + skip, continue
- Per-tab errors in `--all` mode: log + continue with next tab, exit 1 at end if any tab failed
- If `NOTIFY_ON_ERROR_CHANNEL` set + any failure → Slack summary before exit

## Out of scope (v1)

- Two-way sync
- Deletion propagation (Notion → Sheets)
- Historical snapshots / audit log
- Multiple source databases
- Webhook-based real-time sync
- Auto-creating tabs — tabs must exist in Sheet before running

## Remaining setup (user action, post-scaffold)

1. Google Service Account setup — user creates in GCP, downloads JSON → `service-account.json`, shares target Sheet with SA email as Editor (documented in README)
2. Add envs to root `.token.env` (template appended automatically by scaffold step)
