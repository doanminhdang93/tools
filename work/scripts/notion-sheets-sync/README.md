# notion-sheets-sync

One-way sync from the `avadagroup` Notion "Tasks" database to specific tabs of a Google Sheet — one tab per Assignee. Rows upsert by Notion page ID, so manual formatting in the Sheet is preserved.

- Design: [docs/design.md](docs/design.md)
- Implementation plan: [docs/plan.md](docs/plan.md)

## Setup

### 1. Install dependencies

```bash
cd work/scripts/notion-sheets-sync
npm install
```

### 2. Google Service Account

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create or select a project
2. Enable **Google Sheets API** for the project
3. Create a **Service Account** (IAM & Admin → Service Accounts)
4. On the service account → Keys → Add key → **JSON** → download
5. Save the file as `service-account.json` inside this folder (gitignored)
6. Copy the service-account email (looks like `<name>@<project>.iam.gserviceaccount.com`)
7. Open the target Google Sheet → Share → paste the email → give **Editor** access

### 3. Notion integration

The `NOTION_API_KEY` in root `.token.env` must be able to read the Tasks database. In Notion:

- Open the Tasks database → `...` → **Connections** → add your integration

### 4. Root env vars

These are in `/Users/dangdoan/Documents/workspace/Tools/.token.env` (already configured):

```bash
NOTION_API_KEY=<existing>
NOTION_DATABASE_ID=090d542c49d84c1d83370ace1cf52b56
GOOGLE_SHEETS_ID=1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync/service-account.json
SLACK_BOT_TOKEN=<existing>           # optional, for error notifications
NOTIFY_ON_ERROR_CHANNEL=             # optional — set to a channel like "#alerts" to enable Slack alerts
```

Using an **absolute path** for `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` is recommended so cron works regardless of working directory.

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

Edit crontab: `crontab -e`

```cron
0 * * * * cd /Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync && /usr/local/bin/npm run sync -- --all >> sync.log 2>&1
```

Replace `/usr/local/bin/npm` with your own path (`which npm`). On M-series Macs with Homebrew the path is usually `/opt/homebrew/bin/npm`.

## Tests

```bash
npm test           # run vitest suite
npm run typecheck  # TypeScript strict check
```

## Troubleshooting

- **`Tab "X" not in tabs.config.ts`** — add the assignee's exact Notion name to `assignees`, confirm the derived tab name matches the Sheet tab. Use `overrides` only when two assignees collide.
- **403 on Google Sheets** — the target Sheet is not shared with the service-account email.
- **404 on Notion database** — the integration connected to `NOTION_API_KEY` does not have the Tasks database added under Connections.
- **Slack alert not firing** — both `SLACK_BOT_TOKEN` and `NOTIFY_ON_ERROR_CHANNEL` must be set; the bot must be a member of the channel.
- **"Could not parse service account key"** — the JSON file path is wrong, or the file was saved as something other than valid JSON.

## Project layout

```text
work/scripts/notion-sheets-sync/
├── src/
│   ├── index.ts          # CLI entry: arg parse → fetch → per-tab sync
│   ├── sync.ts           # syncTab orchestrator
│   ├── notion.ts         # Notion fetch + assignee filter
│   ├── sheets.ts         # Google Sheets service-account client
│   ├── transform.ts      # Notion property → cell string (dispatch map)
│   ├── name.ts           # Vietnamese-name → tab-name derivation
│   ├── config.ts         # Env loading + zod validation
│   ├── logger.ts         # Console log + optional Slack notify
│   └── __tests__/        # vitest suite (33 tests)
├── columns.config.ts     # 8 columns to sync (order + header)
├── tabs.config.ts        # Assignees + tab-name resolution
├── service-account.json  # Google credential (gitignored)
├── docs/
│   ├── design.md
│   └── plan.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.sample
```
