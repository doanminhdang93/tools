# X Team — tasks dashboard (design)

Internal dashboard + task browser for **X Team**. Reads the Google Sheet that `notion-sheets-sync` already populates; triggers extra syncs on demand.

## Scope

**In scope**

- Dashboard: aggregated points + money per role/per member/per sub-team, with per-role formula displayed
- Tasks tab: filter + sort the synced tasks across all members, with summary stats reflecting the current filter
- Three team tabs (one per sub-team), each pre-filtered to that team's tasks
- Sync trigger: 6-month quick sync + specific-month sync, run against the existing sync tool
- Local run only (single-machine, reuses secrets from workspace-root `.token.env`)

**Out of scope (for now)**

- Auth / multi-user login — runs locally, single developer
- Editing task/member data from the web — all mutation goes through Notion or the sheet
- Hosted deployment, CI, observability
- Charts / historical trends — only current-month snapshot + filter

## Stack

- **Client**: Vite + React + TypeScript. Router-less (two hash-routed tabs is enough) unless state grows.
- **Server**: Express + TypeScript, single process, default port `4000`.
- **Dev**: top-level `npm run dev` launches client + server concurrently (`concurrently` package). Each sub-app has its own `package.json`.
- **Secrets**: reuse workspace-root `.token.env` (`NOTION_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, `GOOGLE_SHEETS_ID`, `NOTION_DATABASE_ID`). No new env vars required.
- **Sheets access**: server imports `createSheetsClient` directly from `../../scripts/notion-sheets-sync/src/sheets/client.ts`. No duplication.
- **Sync**: server imports `syncTab` directly from the same tool. The web's sync button shells out to the same code path as the hourly cron.

## Data model

### `Members` tab (new, in the target Sheet)

| Name | Role | Team |
| --- | --- | --- |
| Đoàn Minh Đăng | developer | DangHieuChien |
| Nguyễn Thị Kim Anh | tester | DangHieuChien |
| … | … | … |

- `Name` = Notion display name (exact, including Vietnamese diacritics)
- `Role` ∈ `developer | tester | PO | Designer` (case-insensitive on read)
- `Team` = one of three team identifiers (see below)

### `Teams` tab (new, in the target Sheet)

| Team | Products |
| --- | --- |
| NhatCuongDuong | Cart Drawer, Free Gift |
| TimoFC | Bundle, PreOrder |
| DangHieuChien | Checkout Upsell, Post Purchase Upsell |

- `Products` comma-separated, human-friendly product names
- `Team` identifier must match `Members.Team` exactly

### App → product mapping (server constant)

Tasks carry an `App` code (`CKU`, `PPU`, …). The server resolves code → product name via a hard-coded map, matching what `notion-sheets-sync/src/constants.ts` already does for display:

```ts
const PRODUCT_BY_APP_CODE = {
  CKU: "Checkout Upsell",
  PPU: "Post Purchase Upsell",
  // extend when new products show up in Notion Tag
};
```

New codes are surfaced as warnings on the dashboard and treated as "unassigned" until the map is updated.

### Role rates

| Role | Rate per point |
| --- | --- |
| developer | 45,000 VND |
| tester | 13,500 VND (= 30% × 45,000) |
| PO | 22,000 VND |
| Designer | 22,000 VND |

Money = `points × rate`. All four formulas are displayed per-member on the dashboard with the concrete numbers plugged in.

## Sync extension (applied to `notion-sheets-sync`)

The existing tool is extended, not replaced.

1. **Add two columns** to the sheet schema: `M = Created date`, `N = Sprint`. Row-1 headers are rewritten on every run (idempotent) so existing tabs pick up the new columns automatically. Past sections stay as-is until re-synced.
2. **New Notion accessors** in `notion/fields.ts`:
   - `createdDateOf(page)` — reuse existing `createdTimeOf` but return the date portion (`YYYY-MM-DD`).
   - `sprintOf(page)` — read Notion `Sprint` property. Type: TBD on first inspection (likely `select` or `relation`); spec gets updated once verified.
3. **`buildTaskRow`** writes to `COLUMN_INDEX.createdDate` and `COLUMN_INDEX.sprint`.
4. **New CLI shortcut** `--recent <N>`: loops `--month` from (current − N + 1) to current, one iteration per month, reusing all existing per-month logic. Defaults `N = 6`. This is the engine for the web's "sync 6 tháng gần nhất" button.

All column changes are backward-compatible: `USER_OWNED_COLUMNS` still only preserves `E | F | L`, nothing user-managed moves.

## UI

### Top navigation (always visible)

`Dashboard | Tasks | NhatCuongDuong | TimoFC | DangHieuChien` with `↻ Sync` on the right.

Clicking a team tab navigates to the Tasks layout but with `Team` filter pre-applied.

### Dashboard (Top-down layout, approved)

Three vertical sections:

1. **Hero stats** — total points, total money (sum of member money), total members. A **Month selector** at the top of the dashboard gates the entire page (hero + team cards + member table); default is current month in Vietnam time. Changing it refetches `/api/tasks?month=...`.
2. **By team** — three cards side-by-side. Each card: team name, products, team points, team money.
3. **By member** — compact table: `Name | Role | Team | Points | Money`. Rows are clickable to show the formula inline (`points × rate = money` with the numbers filled in).

### Tasks (approved)

Header: filter chips (`App`, `Status`, `Assignee`, `Follower`, `Sprint`, `Month`) + sort toggle (`Created ↓↑`, `Sprint`).

Summary bar: `Tasks | Points | Money` reflecting the current filter.

Table columns: `# | Title | App | Status | Assignee | Follower | Points | Money | Created | Sprint`.

Status / App cells are colored tags to match the Sheet's dropdown conventions.

**Each assignee gets the task's full points** — a 10-point task with two assignees counts as 10 points for each of them. Money per assignee = `task.points × assignee.role.rate`. The task row in the table shows:

- `Points` = the task's raw point value (single number, same for all assignees on that task)
- `Money` = **sum across all assignees** of `points × their role rate`

Example: task of 8 pts with Đoàn Minh Đăng (dev) + Nguyễn Thị Kim Anh (tester) → row `Money = 8×45,000 + 8×13,500 = 468,000đ`. Dashboard sums per-person using the same formula, so totals stay consistent.

### Sync modal

Triggered by `↻ Sync`. Two buttons:

- **Sync last 6 months** — calls `POST /api/sync` with `{ mode: "recent", months: 6 }`. Server iterates `syncTab --all` for each of the 6 months (current + 5 prior).
- **Sync specific month** — month picker, calls `POST /api/sync` with `{ mode: "month", month: "M/YYYY" }`. Server runs `syncTab --all --month M/YYYY`.

Both modes sync **all team tabs** — not just the tab the user is currently viewing — because the dashboard/money calculations need the full team picture. The web never triggers per-person sync.

During sync, the modal shows log lines streamed via SSE (`GET /api/sync/stream?id=<id>`). On completion, toast + auto-refresh data.

## API

All JSON, all server-side (no browser-to-Google traffic).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tasks?month=M/YYYY` | All rows for the given month across all member tabs, plus parsed columns |
| `GET` | `/api/members` | `[{ name, role, team }]` from the Members sheet |
| `GET` | `/api/teams` | `[{ team, products }]` from the Teams sheet |
| `POST` | `/api/sync` | `{ mode: "recent", months?: number }` or `{ mode: "month", month: "M/YYYY" }` — starts sync, returns a job id |
| `GET` | `/api/sync/stream?id=<id>` | SSE log stream for the running sync |

Filters + sort happen **client-side** after the single `/api/tasks` fetch. The dataset is small (hundreds of rows per month), so this is simpler than server-side filter plumbing.

## Folder structure

```text
work/web/x-team-tasks/
├── client/                       # Vite + React + TS
│   ├── src/
│   │   ├── App.tsx
│   │   ├── tabs/
│   │   │   ├── Dashboard.tsx
│   │   │   └── Tasks.tsx
│   │   ├── components/
│   │   │   ├── SyncModal.tsx
│   │   │   ├── FilterChips.tsx
│   │   │   └── StatCard.tsx
│   │   ├── api.ts                # fetch helpers typed with shared types
│   │   └── money.ts (+.test)     # role → rate, points × rate
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── server/                       # Express + TS
│   ├── src/
│   │   ├── index.ts              # HTTP server bootstrap
│   │   ├── routes/
│   │   │   ├── tasks.ts
│   │   │   ├── members.ts
│   │   │   ├── teams.ts
│   │   │   └── sync.ts
│   │   ├── read-members.ts (+.test)  # parse Members sheet tab
│   │   ├── read-teams.ts (+.test)    # parse Teams sheet tab
│   │   ├── read-tasks.ts (+.test)    # walk member tabs + current-month section
│   │   └── sync.ts               # thin wrapper around notion-sheets-sync/syncTab
│   ├── package.json
│   └── tsconfig.json
├── shared/                       # types consumed by both sides
│   └── types.ts                  # Member, Team, TaskRow, SyncJob, etc.
├── docs/
│   └── design.md                 # this file
├── README.md
├── package.json                  # root — `npm run dev` runs both concurrently
└── tsconfig.base.json
```

No npm workspaces — the sub-packages install their own deps. The shared folder is imported by relative path with `vite-tsconfig-paths` / Express's `tsconfig-paths` to avoid publish overhead.

## Testing strategy

- **Unit** (`vitest`) for pure functions: money calc, sheet row parsing, filter logic.
- **No integration tests against live Notion / Sheets** — the `notion-sheets-sync` suite already covers those boundaries.
- **Manual smoke** for the UI — user runs locally and spot-checks after changes.

## Open questions (will close during implementation)

1. Notion `Sprint` property type — inspect live before wiring the accessor.
2. Members / Teams tabs may not exist yet — first run without them should surface a friendly "set up Members + Teams tabs" empty state rather than crashing.
