# onboarding-roadmap-sync — Design

**Status**: design approved 2026-05-05, awaiting implementation plan
**Owner**: X Team
**Location**: `work/scripts/onboarding-roadmap-sync/`

## 1. Context

The X Team uses a Notion page **"[Dev] Onboarding - AOV.ai"** (page id `2f4b0da4-49f1-80b0-9425-fee0f44f6834`) as the master template for onboarding new developers. The page contains an inline Notion database **"Onboarding - template"** (db id `2f4b0da4-49f1-81e7-868f-cc54f37e33ab`) whose rows are individual onboarding tasks. Each task has:

- Properties: `Name` (title), `Status` (Not started / In progress / Done), `tag` (Week 1 / 2 / 3 / 4)
- A page body with rich content (objectives, sections, tables, code samples, …)

The team also maintains an internal documentation site at **`https://avada-development.web.app`** (Astro + Starlight + Firebase Auth) that already organises training material by week:

- Week 1 — Warm-up (Getting Started, NodeJS Basic Exercise, KoaJS)
- Week 2 — ReactJS (ReactJS Basic, React Shopify Polaris, Preact)
- Week 3 — Firebase and Shopify (Firebase + Serverless, Shopify, Avada CLI)
- Week 4 — Final exam (Simple Sales Pop)

The roadmap content already exists in the docs site. Maintaining a parallel hand-written copy in Notion creates drift. This tool keeps the Notion master template in sync with the docs site and helps the lead provision a personalised copy whenever a new developer joins.

The Starlight site renders the article body server-side and serves the underlying HTML publicly even when the Firebase auth gate is active client-side, so the tool can fetch content without holding any auth credential.

## 2. Goals

- One command to bootstrap or re-sync the master template's tasks from the docs site (Week 1 – 4)
- One command to add or refresh a single task from a docs URL
- One command to customise a Notion-duplicated copy of the master template for a specific developer
- Smart merge that never destroys the developer's `Status` / `tag` / `Name` edits
- Setup straightforward enough that any X Team member can run the tool

## 3. Non-goals

- Programmatic duplication of the master page (Notion API has no duplicate endpoint; users hit the UI's "Duplicate" — which clones the inline DB cleanly — then run `new-dev` to customise)
- Two-way sync (docs site is the source of truth for content; Notion owns developer state)
- Editing arbitrary Notion pages or databases unrelated to the X Team onboarding template
- Auto-archiving tasks when their docs page disappears from the sidebar (the tool only logs orphans; the lead resolves manually)
- Auto-sharing the duplicated page with the new developer's Notion account (Notion API does not let an integration share a page with a user; team handles invites manually)

## 4. Architecture overview

A single-purpose CLI tool, modelled after `work/scripts/notion-sheets-sync/`, written in TypeScript on Node.js. Three entry points (`sync`, `add-task`, `new-dev`) share a common library of Notion helpers, a docs fetcher, and an HTML-to-Notion-blocks converter.

```text
docs site (HTTPS, public HTML)
        │
        ▼
docs-fetcher  ──►  html-to-blocks  ──►  notion-client  ──►  Notion API
                                              ▲
                                              │
                                          matching
                                       (Source URL +
                                        Source Hash)
```text

## 5. Configuration

Hardcoded in `config.ts` (constants, no env-var indirection — this tool has exactly one target page):

| Constant | Value |
| --- | --- |
| `DOCS_BASE_URL` | `https://avada-development.web.app` |
| `SIDEBAR_SEED_URL` | `https://avada-development.web.app/training-docs/week-1-warm-up/i01-nodejs_basic/` (any training-docs page works; homepage lacks the Week sidebar) |
| `NOTION_PAGE_ID` | `2f4b0da4-49f1-80b0-9425-fee0f44f6834` (master template page) |
| `NOTION_DB_ID` | `2f4b0da4-49f1-81e7-868f-cc54f37e33ab` (inline DB inside that page) |
| `WEEK_SECTIONS` | `{ 1: "Week 1 Warm-up", 2: "Week 2 ReactJS", 3: "Week 3 Firebase and Shopify", 4: "Week 4 Final exam" }` — sidebar group labels |
| `DEFAULT_STATUS_FOR_NEW_TASK` | `"Not started"` |
| `RATE_LIMIT_MS` | `350` (≈ 3 req/s) |

`NOTION_API_KEY` is read from the workspace-root `.token.env` (already populated and shared with `notion-sheets-sync`'s integration `X Team`).

## 6. Data model

### 6.1 Existing DB schema (do not alter)

| Property | Type | Owner |
| --- | --- | --- |
| `Name` | title | developer (may rename for context) |
| `Status` | status (Not started / In progress / Done) | developer (state) |
| `tag` | select (Week 1 / 2 / 3 / 4) | developer (may reschedule) |

### 6.2 New properties added by the tool (auto-created on first run via `databases.update`)

| Property | Type | Owner |
| --- | --- | --- |
| `Source URL` | url | tool — match key, never edited by hand |
| `Source Hash` | rich_text | tool — first 16 chars of SHA-256 of normalised content |

### 6.3 Merge rules during sync (`sync` and `add-task` only)

When a task already exists (matched by `Source URL`):

- Always overwritable by the tool: `Source Hash`, page body content (only when hash differs)
- Never overwritten by the tool: `Name`, `Status`, `tag`

When a task is created for the first time, the tool sets `Name` (from docs page title), `tag` (from sidebar Week section), `Status = "Not started"`, `Source URL`, `Source Hash`, and appends body content.

Orphan handling: if a row in the DB has a `Source URL` no longer present in the sidebar, the tool logs a warning naming the task — it never archives or deletes.

> The `new-dev` command (§7.3) is **not** subject to these merge rules — it intentionally resets `Status` because it operates on a freshly-duplicated copy that should start clean for the new developer.

## 7. Commands

### 7.1 `npm run sync`

Batch sync of all Week 1 – 4 docs pages into the master template. Idempotent.

```text
1. Load NOTION_API_KEY from .token.env
2. Ensure DB schema includes Source URL + Source Hash; create if missing
3. Fetch DOCS_BASE_URL → parse sidebar HTML → list { week, title, url }
   for every link under each WEEK_SECTIONS label
4. Query DB → build map { Source URL → { page_id, Source Hash } }
5. For each docs item:
     a. Fetch the page HTML, extract main content (`<div class="sl-markdown-content">`)
     b. Compute hash = sha256(normalisedText).slice(0, 16)
     c. If Source URL not in map → create task (Name, tag, Status, Source URL, Source Hash) and append converted blocks → counter `created`
     d. Else if stored hash != new hash → wipe existing children blocks, append new ones, update Source Hash → counter `updated`
     e. Else → skip → counter `skipped`
6. Identify orphans (URLs in map but not in current sidebar) → log warning per orphan
7. Print summary `Created N, Updated M, Skipped K, Orphans X`
```text

Flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Run steps 1 – 4 + dry version of 5 (logs intent, no Notion writes) |
| `--force` | Bypass hash comparison; always rewrite body for every matched task |
| `--week N` | Limit to a single week (1 – 4) |

### 7.2 `npm run add-task -- --url <docs-url> --week <N>`

Add or update one task from a single docs URL.

```text
1. Validate <docs-url> starts with DOCS_BASE_URL
2. If --week missing → interactive prompt (Week 1 / 2 / 3 / 4) via @inquirer/prompts
3. Fetch + hash + upsert exactly as step 5 of `sync` for this single URL
4. Print which branch was taken (created / updated / skipped)
```text

### 7.3 `npm run new-dev -- --page <duplicated-page-url> --name "<dev name>"`

Customise a Notion-duplicated copy of the master template for a new developer. Assumes the lead has already used Notion's UI to duplicate the master page (which clones the inline DB plus every task page faithfully).

```text
1. Parse page_id from <duplicated-page-url>
2. Fetch page → confirm title starts with "[Dev] Onboarding" and contains an inline DB
3. Update page title → "[Dev] Onboarding - <dev name>"
4. Locate inline DB inside the duplicated page (first child_database block)
5. Query that DB → for every task, set Status = "Not started"
6. Print "Renamed page + reset N tasks"
```text

If `--name` is missing → interactive prompt. If `--page` is missing → fail with usage message (no sensible default).

## 8. HTML → Notion blocks conversion

Performed by `html-to-blocks.ts`, using `cheerio` to walk the DOM under `<div class="sl-markdown-content">`.

### 8.1 Mapping

| HTML | Notion block | Notes |
| --- | --- | --- |
| `<h1>` `<h2>` `<h3>` | `heading_1` / `heading_2` / `heading_3` | `<h4>`+ → `heading_3` |
| `<p>` | `paragraph` | rich_text with inline annotations |
| `<ul><li>` | `bulleted_list_item` | nested lists become block children |
| `<ol><li>` | `numbered_list_item` | |
| `<blockquote>` | `quote` | |
| `<pre><code class="language-X">` | `code` | language from class, fallback `plain text` |
| `<hr>` | `divider` | |
| `<img src>` | `image` (external URL) | resolve relative URLs against `DOCS_BASE_URL` |
| `<table>` | `table` + `table_row` children | column count = max cells of any row, header row preserved |
| `<aside class="starlight-aside-*">` | `callout` | icon by aside type (note 💡, tip ✅, caution ⚠️, danger 🛑) |
| Inline `<a>` `<strong>` `<em>` `<code>` | rich_text annotations | combine on a single rich_text element |

### 8.2 Skipped or degraded

- `<details><summary>` → flatten: emit `summary` text as a paragraph, then continue with the children blocks
- Starlight tabs / cards / linkcards → render text content as paragraphs prefixed `📑`
- `<iframe>` / video embeds → emit `embed` block if URL is HTTP(S), otherwise log warning and skip
- Anything unrecognised → log warning with element tag + URL, skip

### 8.3 Notion API limits enforced

- Max 100 children per `blocks.children.append` → chunk uploads
- Max 2000 chars per rich_text → split paragraph text into multiple rich_text fragments (or multiple paragraphs if a single fragment exceeds the limit)
- Max 100 rich_text per block → split paragraph into multiple blocks if the inline annotation count exceeds the limit
- ≈ 3 req/s rate limit → `await sleep(RATE_LIMIT_MS)` between requests; on 429, exponential back-off (start 1 s, double, max 3 retries)

## 9. Body content update strategy

When a task already exists and its hash differs:

```text
1. Paginate blocks.children.list → collect all child block ids of the task page
2. For each id, blocks.delete (Notion has no batch delete)
3. blocks.children.append the new blocks in chunks of 100
```text

Wipe-and-replace is intentional: the tool owns body content (it is regenerated from docs). Developer state lives entirely in properties (`Status`, `tag`, `Name`), which are never touched on update.

## 10. Error handling

| Scenario | Behaviour |
| --- | --- |
| Network error fetching docs | Log error, skip that URL, continue with the rest |
| HTML structure unexpected (no `sl-markdown-content`) | Log warning naming URL, skip |
| Notion 429 | Exponential back-off, retry up to 3 times |
| Notion 404 on page id | Fail loudly — config is wrong |
| Integration lacks access to page | Fail with hint to add `X Team` connection in Notion UI |
| `Source URL` / `Source Hash` property missing | Auto-create via `databases.update` on first run |
| Two docs URLs map to the same Notion task (duplicate `Source URL`) | Log warning, only update the first match |

## 11. File structure

```text
work/scripts/onboarding-roadmap-sync/
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── config.ts
├── src/
│   ├── sync.ts
│   ├── add-task.ts
│   ├── new-dev.ts
│   ├── docs-fetcher.ts
│   ├── html-to-blocks.ts
│   ├── notion-client.ts
│   ├── matching.ts
│   ├── chunking.ts
│   └── logger.ts
├── tests/
│   ├── html-to-blocks.test.ts
│   ├── docs-fetcher.test.ts
│   └── fixtures/
│       ├── sidebar.html
│       └── coding-standard.html
├── docs/
│   └── design.md
└── .gitignore
```text

## 12. Dependencies

| Package | Purpose |
| --- | --- |
| `@notionhq/client` | Notion SDK |
| `cheerio` | HTML parser |
| `@inquirer/prompts` | Interactive prompts when CLI flags missing |
| `commander` | CLI argument parsing |
| `dotenv` | Load workspace `.token.env` |
| `typescript`, `tsx`, `@types/node` | TS runtime + types |
| `vitest` | Tests (fixtures, no Notion mocks) |

## 13. Testing strategy

- `tests/html-to-blocks.test.ts` — unit tests over saved HTML fixtures, asserting the produced Notion block tree matches expected JSON. The HTML-to-blocks layer is the most error-prone surface; tests cover headings, lists (including nested), code blocks, blockquotes, tables, asides, images, and inline annotations.
- `tests/docs-fetcher.test.ts` — unit tests over a saved sidebar HTML fixture, asserting the parser returns the correct `{ week, title, url }` triples for Week 1 – 4.
- No Notion API mocks. Smoke verification is done by running `npm run sync -- --dry-run` against the real workspace (per workspace policy: integration tests prefer real services to mocks).

## 14. Setup for team members

Documented in `README.md`:

1. `git clone` the workspace and `cd work/scripts/onboarding-roadmap-sync`
2. `npm install`
3. Confirm workspace-root `.token.env` contains `NOTION_API_KEY` (same `X Team` integration as `notion-sheets-sync`)
4. Lead does once per Notion workspace: in Notion UI, open the master page → `...` → `Connections` → add `X Team`
5. `npm run sync -- --dry-run` to verify reachability

For provisioning a new developer:

1. Open master page in Notion → `...` → `Duplicate` → rename later
2. Copy the duplicated page's URL
3. `npm run new-dev -- --page <copied-url> --name "<dev full name>"`
4. Manually share the new page with the developer via Notion UI

## 15. Out of scope (revisit later if needed)

- General-purpose Notion CLI for unrelated pages or databases
- Programmatic page duplication (would need full property + child-block + child-DB clone)
- Bidirectional sync (Notion → docs site)
- Slack / email notification when sync runs
- Bulk archive on sprint completion
- Per-developer progress reporting
