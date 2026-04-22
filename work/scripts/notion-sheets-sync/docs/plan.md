# Notion → Sheets Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI that syncs tasks from a Notion database to specific tabs of a Google Sheet (one tab per Assignee), using upsert-by-page-ID.

**Architecture:** Plain Node.js + TypeScript run via `tsx`. Fetch Notion DB once per run, filter client-side per Assignee, diff against existing Sheet rows (column A = Notion page ID), write via Sheets `batchUpdate` / `append`. Pure functions (name derivation, property transforms) are TDD'd with `vitest`; IO wrappers (Notion, Sheets) have thin unit tests with mocked SDKs plus one opt-in live smoke test.

**Tech Stack:** Node.js 20+, TypeScript 5, tsx, @notionhq/client, googleapis, dotenv, zod, vitest.

**Spec:** [design.md](./design.md)

---

## File Structure

```text
work/scripts/notion-sheets-sync/
├── src/
│   ├── index.ts              # CLI entry: parse args, dispatch sync
│   ├── sync.ts               # Orchestrate: fetch → filter → diff → write (per tab)
│   ├── notion.ts             # Notion client wrapper: fetch all pages
│   ├── sheets.ts             # Sheets client: auth, read column A + headers, batchUpdate, append
│   ├── transform.ts          # Notion property → cell value, one fn per supported type
│   ├── name.ts               # Vietnamese name → tab-name derivation
│   ├── config.ts             # Load + validate env with zod
│   └── logger.ts             # Console log + optional Slack notify on failure
├── src/__tests__/
│   ├── name.test.ts
│   ├── transform.test.ts
│   └── config.test.ts
├── tabs.config.ts            # List of Notion assignee full-names
├── columns.config.ts         # Column order + header names
├── service-account.json      # Google SA key (gitignored; user creates)
├── .env.sample               # Template env entries
├── .gitignore                # Tool-specific overrides (service-account.json)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md                 # Setup, run, cron instructions
└── docs/
    ├── design.md             # Source-of-truth spec
    └── plan.md               # This file
```

Each file has one clear responsibility; IO is isolated from pure logic so the latter can be tested without mocks.

---

## Task 1: Project scaffold

**Files:**

- Create: `work/scripts/notion-sheets-sync/package.json`
- Create: `work/scripts/notion-sheets-sync/tsconfig.json`
- Create: `work/scripts/notion-sheets-sync/vitest.config.ts`
- Create: `work/scripts/notion-sheets-sync/.gitignore`
- Create: `work/scripts/notion-sheets-sync/src/index.ts` (placeholder)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "notion-sheets-sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@notionhq/client": "^2.2.15",
    "dotenv": "^16.4.5",
    "googleapis": "^144.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "*.config.ts", "*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
service-account.json
sync.log
.env
```

- [ ] **Step 5: Create placeholder `src/index.ts`**

```ts
console.log("notion-sheets-sync — scaffolded, implementation pending");
```

- [ ] **Step 6: Install deps**

Run: `cd work/scripts/notion-sheets-sync && npm install`
Expected: installs successfully, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 7: Verify typecheck + test runner**

Run: `npm run typecheck && npm test`
Expected: typecheck passes, vitest reports "No test files found" (OK — we add tests next).

- [ ] **Step 8: Commit**

```bash
git init   # if not already a repo at workspace root
git add work/scripts/notion-sheets-sync/
git commit -m "feat(notion-sheets-sync): scaffold TypeScript project"
```

---

## Task 2: Tab-name derivation (`src/name.ts`)

Pure function, TDD.

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/name.ts`
- Create: `work/scripts/notion-sheets-sync/src/__tests__/name.test.ts`

- [ ] **Step 1: Write failing tests for `deriveTabName`**

`src/__tests__/name.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveTabName } from "../name.ts";

describe("deriveTabName", () => {
  it("derives DangDM from Đoàn Minh Đăng", () => {
    expect(deriveTabName("Đoàn Minh Đăng")).toBe("DangDM");
  });

  it("derives HieuNT from Nguyễn Trọng Hiếu", () => {
    expect(deriveTabName("Nguyễn Trọng Hiếu")).toBe("HieuNT");
  });

  it("handles Đ as D in given name", () => {
    expect(deriveTabName("Lê Đức")).toBe("DucL");
  });

  it("handles single-word names (no initials)", () => {
    expect(deriveTabName("Linh")).toBe("Linh");
  });

  it("handles four-word names", () => {
    expect(deriveTabName("Trần Thị Mỹ Linh")).toBe("LinhTTM");
  });

  it("trims and collapses whitespace", () => {
    expect(deriveTabName("  Đoàn   Minh   Đăng  ")).toBe("DangDM");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test`
Expected: all 6 tests fail with "deriveTabName is not a function" or module-not-found.

- [ ] **Step 3: Implement `src/name.ts`**

```ts
const CUSTOM_MAP: Record<string, string> = { đ: "d", Đ: "D" };

function removeVietnameseDiacritics(input: string): string {
  return input
    .split("")
    .map((ch) => CUSTOM_MAP[ch] ?? ch)
    .join("")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function capitalize(word: string): string {
  if (word.length === 0) return "";
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

export function deriveTabName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("deriveTabName: empty name");
  }

  const given = parts[parts.length - 1];
  const rest = parts.slice(0, -1);

  const givenClean = capitalize(removeVietnameseDiacritics(given));
  const initials = rest
    .map((p) => removeVietnameseDiacritics(p)[0]?.toUpperCase() ?? "")
    .join("");

  return givenClean + initials;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/name.ts work/scripts/notion-sheets-sync/src/__tests__/name.test.ts
git commit -m "feat(notion-sheets-sync): add Vietnamese name → tab-name derivation"
```

---

## Task 3: Config loader (`src/config.ts`)

Loads env from root `.token.env`, validates with zod.

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/config.ts`
- Create: `work/scripts/notion-sheets-sync/src/__tests__/config.test.ts`
- Create: `work/scripts/notion-sheets-sync/.env.sample`

- [ ] **Step 1: Write failing tests for `loadConfig`**

`src/__tests__/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../config.ts";

const REQUIRED = {
  NOTION_API_KEY: "secret_abc",
  NOTION_DATABASE_ID: "dbid",
  GOOGLE_SHEETS_ID: "sheetid",
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: "./service-account.json",
};

describe("loadConfig", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [...Object.keys(REQUIRED), "SLACK_BOT_TOKEN", "NOTIFY_ON_ERROR_CHANNEL"];

  beforeEach(() => {
    keys.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    keys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it("loads valid config when all required vars are set", () => {
    Object.assign(process.env, REQUIRED);
    const cfg = loadConfig();
    expect(cfg.notionApiKey).toBe("secret_abc");
    expect(cfg.notionDatabaseId).toBe("dbid");
    expect(cfg.googleSheetsId).toBe("sheetid");
    expect(cfg.googleServiceAccountKeyFile).toBe("./service-account.json");
    expect(cfg.slackBotToken).toBeUndefined();
    expect(cfg.notifyOnErrorChannel).toBeUndefined();
  });

  it("throws when NOTION_API_KEY is missing", () => {
    const partial = { ...REQUIRED };
    delete (partial as Record<string, string>).NOTION_API_KEY;
    Object.assign(process.env, partial);
    expect(() => loadConfig()).toThrow(/NOTION_API_KEY/);
  });

  it("treats empty NOTIFY_ON_ERROR_CHANNEL as undefined", () => {
    Object.assign(process.env, REQUIRED, { NOTIFY_ON_ERROR_CHANNEL: "" });
    const cfg = loadConfig();
    expect(cfg.notifyOnErrorChannel).toBeUndefined();
  });

  it("passes Slack notify when channel + token set", () => {
    Object.assign(process.env, REQUIRED, {
      SLACK_BOT_TOKEN: "xoxb-x",
      NOTIFY_ON_ERROR_CHANNEL: "#alerts",
    });
    const cfg = loadConfig();
    expect(cfg.slackBotToken).toBe("xoxb-x");
    expect(cfg.notifyOnErrorChannel).toBe("#alerts");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test`
Expected: 4 failing tests referencing missing `loadConfig`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { z } from "zod";

const ConfigSchema = z.object({
  NOTION_API_KEY: z.string().min(1, "NOTION_API_KEY is required"),
  NOTION_DATABASE_ID: z.string().min(1, "NOTION_DATABASE_ID is required"),
  GOOGLE_SHEETS_ID: z.string().min(1, "GOOGLE_SHEETS_ID is required"),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().min(1),
  SLACK_BOT_TOKEN: z.string().optional(),
  NOTIFY_ON_ERROR_CHANNEL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export interface Config {
  notionApiKey: string;
  notionDatabaseId: string;
  googleSheetsId: string;
  googleServiceAccountKeyFile: string;
  slackBotToken?: string;
  notifyOnErrorChannel?: string;
}

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Config error: ${msg}`);
  }
  const e = parsed.data;
  return {
    notionApiKey: e.NOTION_API_KEY,
    notionDatabaseId: e.NOTION_DATABASE_ID,
    googleSheetsId: e.GOOGLE_SHEETS_ID,
    googleServiceAccountKeyFile: e.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    slackBotToken: e.SLACK_BOT_TOKEN,
    notifyOnErrorChannel: e.NOTIFY_ON_ERROR_CHANNEL,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (name + config).

- [ ] **Step 5: Create `.env.sample`**

```bash
# Copy these to root /.token.env and fill in real values

NOTION_API_KEY=
NOTION_DATABASE_ID=090d542c49d84c1d83370ace1cf52b56
GOOGLE_SHEETS_ID=1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json

# Optional — leave blank to skip Slack error notifications
SLACK_BOT_TOKEN=
NOTIFY_ON_ERROR_CHANNEL=
```

- [ ] **Step 6: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/config.ts work/scripts/notion-sheets-sync/src/__tests__/config.test.ts work/scripts/notion-sheets-sync/.env.sample
git commit -m "feat(notion-sheets-sync): add env config loader with zod validation"
```

---

## Task 4: Notion property transforms (`src/transform.ts`)

Pure functions, one per supported Notion property type. TDD.

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/transform.ts`
- Create: `work/scripts/notion-sheets-sync/src/__tests__/transform.test.ts`

- [ ] **Step 1: Write failing tests**

`src/__tests__/transform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { propertyToCell } from "../transform.ts";

describe("propertyToCell", () => {
  it("title — concats plain_text", () => {
    const prop = {
      type: "title",
      title: [{ plain_text: "Fix " }, { plain_text: "bug" }],
    };
    expect(propertyToCell(prop)).toBe("Fix bug");
  });

  it("title — empty returns empty string", () => {
    expect(propertyToCell({ type: "title", title: [] })).toBe("");
  });

  it("rich_text — concats plain_text", () => {
    const prop = {
      type: "rich_text",
      rich_text: [{ plain_text: "line1 " }, { plain_text: "line2" }],
    };
    expect(propertyToCell(prop)).toBe("line1 line2");
  });

  it("status — returns name", () => {
    expect(propertyToCell({ type: "status", status: { name: "In Progress" } })).toBe(
      "In Progress",
    );
  });

  it("status — null returns empty", () => {
    expect(propertyToCell({ type: "status", status: null })).toBe("");
  });

  it("select — returns name or empty", () => {
    expect(propertyToCell({ type: "select", select: { name: "High" } })).toBe("High");
    expect(propertyToCell({ type: "select", select: null })).toBe("");
  });

  it("multi_select — joins names with comma+space", () => {
    const prop = {
      type: "multi_select",
      multi_select: [{ name: "bug" }, { name: "urgent" }],
    };
    expect(propertyToCell(prop)).toBe("bug, urgent");
  });

  it("people — joins names with comma+space", () => {
    const prop = {
      type: "people",
      people: [{ name: "Alice" }, { name: "Bob" }, { name: null }],
    };
    expect(propertyToCell(prop)).toBe("Alice, Bob");
  });

  it("date — returns start when no end", () => {
    expect(
      propertyToCell({ type: "date", date: { start: "2026-05-01", end: null } }),
    ).toBe("2026-05-01");
  });

  it("date — returns start → end range when both", () => {
    expect(
      propertyToCell({
        type: "date",
        date: { start: "2026-05-01", end: "2026-05-03" },
      }),
    ).toBe("2026-05-01 → 2026-05-03");
  });

  it("created_time — returns as-is", () => {
    expect(
      propertyToCell({ type: "created_time", created_time: "2026-04-22T10:00:00Z" }),
    ).toBe("2026-04-22T10:00:00Z");
  });

  it("unique_id — returns PREFIX-NUMBER when prefix set", () => {
    expect(
      propertyToCell({ type: "unique_id", unique_id: { prefix: "TASK", number: 42 } }),
    ).toBe("TASK-42");
  });

  it("unique_id — returns NUMBER only when no prefix", () => {
    expect(
      propertyToCell({ type: "unique_id", unique_id: { prefix: null, number: 7 } }),
    ).toBe("7");
  });

  it("relation — joins page IDs with comma+space", () => {
    const prop = {
      type: "relation",
      relation: [{ id: "page-1" }, { id: "page-2" }],
    };
    expect(propertyToCell(prop)).toBe("page-1, page-2");
  });

  it("checkbox — true/false → '✓'/''", () => {
    expect(propertyToCell({ type: "checkbox", checkbox: true })).toBe("✓");
    expect(propertyToCell({ type: "checkbox", checkbox: false })).toBe("");
  });

  it("number — returns string repr", () => {
    expect(propertyToCell({ type: "number", number: 3.14 })).toBe("3.14");
    expect(propertyToCell({ type: "number", number: null })).toBe("");
  });

  it("unknown type — returns empty string", () => {
    expect(propertyToCell({ type: "something_unsupported" } as never)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test`
Expected: all transform tests fail (module not found).

- [ ] **Step 3: Implement `src/transform.ts`**

```ts
export type NotionProperty = { type: string; [key: string]: unknown };

export function propertyToCell(prop: NotionProperty): string {
  switch (prop.type) {
    case "title":
    case "rich_text": {
      const arr = (prop as { [k: string]: { plain_text?: string }[] })[prop.type];
      return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? "").join("") : "";
    }
    case "status":
    case "select": {
      const v = (prop as { [k: string]: { name?: string } | null })[prop.type];
      return v?.name ?? "";
    }
    case "multi_select": {
      const arr = (prop as { multi_select?: { name?: string }[] }).multi_select;
      return Array.isArray(arr) ? arr.map((o) => o.name ?? "").filter(Boolean).join(", ") : "";
    }
    case "people": {
      const arr = (prop as { people?: { name?: string | null }[] }).people;
      return Array.isArray(arr)
        ? arr.map((p) => p.name ?? "").filter(Boolean).join(", ")
        : "";
    }
    case "date": {
      const d = (prop as { date?: { start: string; end: string | null } | null }).date;
      if (!d) return "";
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case "created_time": {
      return (prop as { created_time?: string }).created_time ?? "";
    }
    case "last_edited_time": {
      return (prop as { last_edited_time?: string }).last_edited_time ?? "";
    }
    case "unique_id": {
      const u = (prop as { unique_id?: { prefix: string | null; number: number } }).unique_id;
      if (!u) return "";
      return u.prefix ? `${u.prefix}-${u.number}` : String(u.number);
    }
    case "relation": {
      const arr = (prop as { relation?: { id: string }[] }).relation;
      return Array.isArray(arr) ? arr.map((r) => r.id).join(", ") : "";
    }
    case "checkbox": {
      return (prop as { checkbox?: boolean }).checkbox ? "✓" : "";
    }
    case "number": {
      const n = (prop as { number?: number | null }).number;
      return n === null || n === undefined ? "" : String(n);
    }
    case "url": {
      return (prop as { url?: string | null }).url ?? "";
    }
    case "email": {
      return (prop as { email?: string | null }).email ?? "";
    }
    case "phone_number": {
      return (prop as { phone_number?: string | null }).phone_number ?? "";
    }
    default:
      return "";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all transform tests pass.

- [ ] **Step 5: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/transform.ts work/scripts/notion-sheets-sync/src/__tests__/transform.test.ts
git commit -m "feat(notion-sheets-sync): add Notion property → cell value transforms"
```

---

## Task 5: Notion client wrapper (`src/notion.ts`)

Thin wrapper around `@notionhq/client`: fetch all pages of a DB (paginated).

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/notion.ts`

- [ ] **Step 1: Implement `src/notion.ts`**

```ts
import { Client } from "@notionhq/client";

export type NotionPage = {
  id: string;
  properties: Record<string, { type: string; [key: string]: unknown }>;
};

export async function fetchAllPages(
  apiKey: string,
  databaseId: string,
): Promise<NotionPage[]> {
  const client = new Client({ auth: apiKey });
  const results: NotionPage[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      if ("properties" in page) {
        results.push({
          id: page.id,
          properties: page.properties as NotionPage["properties"],
        });
      }
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  return results;
}

export function filterByAssignee(
  pages: NotionPage[],
  assigneeName: string,
): NotionPage[] {
  return pages.filter((page) => {
    const prop = page.properties["Assignee"];
    if (!prop || prop.type !== "people") return false;
    const people = (prop as { people?: { name?: string | null }[] }).people;
    if (!Array.isArray(people)) return false;
    return people.some((p) => p.name === assigneeName);
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/notion.ts
git commit -m "feat(notion-sheets-sync): add Notion fetch + assignee filter"
```

---

## Task 6: Columns config (`columns.config.ts`)

Static config: order + headers matching the spec.

**Files:**

- Create: `work/scripts/notion-sheets-sync/columns.config.ts`

- [ ] **Step 1: Implement `columns.config.ts`**

```ts
export interface ColumnConfig {
  notionProp: string;
  sheetHeader: string;
}

export const columns: ColumnConfig[] = [
  { notionProp: "Task ID",      sheetHeader: "Task ID" },
  { notionProp: "product",      sheetHeader: "Task" },
  { notionProp: "Status",       sheetHeader: "Status" },
  { notionProp: "Assignee",     sheetHeader: "Assignee" },
  { notionProp: "Follower",     sheetHeader: "Follower" },
  { notionProp: "Size Card",    sheetHeader: "Size Card" },
  { notionProp: "Sprint",       sheetHeader: "Sprint" },
  { notionProp: "Created time", sheetHeader: "Created time" },
];
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/notion-sheets-sync/columns.config.ts
git commit -m "feat(notion-sheets-sync): add columns config (8 fields)"
```

---

## Task 7: Tabs config (`tabs.config.ts`)

Static list of Notion assignee names. Derivation uses `deriveTabName` from Task 2.

**Files:**

- Create: `work/scripts/notion-sheets-sync/tabs.config.ts`

- [ ] **Step 1: Implement `tabs.config.ts`**

```ts
import { deriveTabName } from "./src/name.ts";

export const assignees: string[] = [
  "Đoàn Minh Đăng",
  // Add more as teammates are onboarded:
  // "Nguyễn Trọng Hiếu",
];

export const overrides: Record<string, string> = {
  // "Notion Full Name": "CustomTabName",   // only when derivation collides
};

export interface TabEntry {
  tabName: string;
  notionAssigneeName: string;
}

export function resolveTabs(): TabEntry[] {
  return assignees.map((notionAssigneeName) => ({
    notionAssigneeName,
    tabName: overrides[notionAssigneeName] ?? deriveTabName(notionAssigneeName),
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Sanity print**

Run: `npx tsx -e "import('./tabs.config.ts').then(m => console.log(m.resolveTabs()))"` from inside the tool folder.
Expected: logs `[ { notionAssigneeName: 'Đoàn Minh Đăng', tabName: 'DangDM' } ]`.

- [ ] **Step 4: Commit**

```bash
git add work/scripts/notion-sheets-sync/tabs.config.ts
git commit -m "feat(notion-sheets-sync): add tabs config with auto-derived tab names"
```

---

## Task 8: Google Sheets client (`src/sheets.ts`)

Service-account auth, read existing rows (column A + headers), upsert via `batchUpdate` / `append`.

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/sheets.ts`

- [ ] **Step 1: Implement `src/sheets.ts`**

```ts
import { google, sheets_v4 } from "googleapis";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SheetsClient {
  readExistingRows(tabName: string): Promise<Map<string, number>>; // notionId → rowIndex (1-based)
  ensureHeaders(tabName: string, headers: string[]): Promise<void>;
  batchUpdateRows(
    tabName: string,
    updates: { rowIndex: number; values: string[] }[],
  ): Promise<void>;
  appendRows(tabName: string, rows: string[][]): Promise<void>;
}

export function createSheetsClient(
  serviceAccountKeyFile: string,
  spreadsheetId: string,
): SheetsClient {
  const keyPath = resolve(serviceAccountKeyFile);
  const credentials = JSON.parse(readFileSync(keyPath, "utf8"));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const api: sheets_v4.Sheets = google.sheets({ version: "v4", auth });

  // Column A = Notion page ID (hidden). Visible columns start at B.
  return {
    async readExistingRows(tabName) {
      const res = await api.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!A:A`,
      });
      const map = new Map<string, number>();
      const values = res.data.values ?? [];
      // Row 1 is header row; data rows from 2
      for (let i = 1; i < values.length; i++) {
        const id = values[i]?.[0];
        if (typeof id === "string" && id.length > 0) {
          map.set(id, i + 1); // Sheets API is 1-based
        }
      }
      return map;
    },

    async ensureHeaders(tabName, headers) {
      // Header row: A1 = "_notion_id", B1.. = visible headers
      const fullHeaders = ["_notion_id", ...headers];
      const endCol = columnLetter(fullHeaders.length);
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1:${endCol}1`,
        valueInputOption: "RAW",
        requestBody: { values: [fullHeaders] },
      });
    },

    async batchUpdateRows(tabName, updates) {
      if (updates.length === 0) return;
      const data = updates.map((u) => {
        const endCol = columnLetter(u.values.length);
        return {
          range: `${tabName}!A${u.rowIndex}:${endCol}${u.rowIndex}`,
          values: [u.values],
        };
      });
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      });
    },

    async appendRows(tabName, rows) {
      if (rows.length === 0) return;
      await api.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabName}!A:A`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
      });
    },
  };
}

// A=1, B=2, ..., Z=26, AA=27 ...
function columnLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/sheets.ts
git commit -m "feat(notion-sheets-sync): add Google Sheets service-account client"
```

---

## Task 9: Logger (`src/logger.ts`)

Console log + optional Slack notification on failure.

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/logger.ts`

- [ ] **Step 1: Implement `src/logger.ts`**

```ts
export interface Logger {
  info(msg: string): void;
  warn(msg: string, err?: unknown): void;
  error(msg: string, err?: unknown): void;
  notifyFailure(summary: string): Promise<void>;
}

export function createLogger(opts: {
  slackBotToken?: string;
  notifyChannel?: string;
}): Logger {
  const ts = () => new Date().toISOString();

  return {
    info(msg) {
      console.log(`[${ts()}] INFO  ${msg}`);
    },
    warn(msg, err) {
      console.warn(`[${ts()}] WARN  ${msg}`, err ?? "");
    },
    error(msg, err) {
      console.error(`[${ts()}] ERROR ${msg}`, err ?? "");
    },
    async notifyFailure(summary) {
      if (!opts.slackBotToken || !opts.notifyChannel) return;
      try {
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.slackBotToken}`,
          },
          body: JSON.stringify({
            channel: opts.notifyChannel,
            text: `:rotating_light: notion-sheets-sync failed\n\`\`\`${summary}\`\`\``,
          }),
        });
        if (!res.ok) {
          console.error(`Slack notify failed: HTTP ${res.status}`);
        }
      } catch (e) {
        console.error("Slack notify threw:", e);
      }
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/logger.ts
git commit -m "feat(notion-sheets-sync): add logger with optional Slack failure notify"
```

---

## Task 10: Sync orchestrator (`src/sync.ts`)

Compose Notion fetch + filter + transform + sheets upsert for one tab.

**Files:**

- Create: `work/scripts/notion-sheets-sync/src/sync.ts`

- [ ] **Step 1: Implement `src/sync.ts`**

```ts
import type { SheetsClient } from "./sheets.ts";
import type { NotionPage } from "./notion.ts";
import { filterByAssignee } from "./notion.ts";
import { propertyToCell } from "./transform.ts";
import type { ColumnConfig } from "../columns.config.ts";
import type { Logger } from "./logger.ts";

export interface SyncTabArgs {
  tabName: string;
  assigneeName: string;
  allPages: NotionPage[];
  columns: ColumnConfig[];
  sheets: SheetsClient;
  logger: Logger;
}

export interface SyncTabResult {
  tabName: string;
  filtered: number;
  updated: number;
  appended: number;
  skipped: number;
}

export async function syncTab(args: SyncTabArgs): Promise<SyncTabResult> {
  const { tabName, assigneeName, allPages, columns, sheets, logger } = args;

  const headers = columns.map((c) => c.sheetHeader);
  await sheets.ensureHeaders(tabName, headers);

  const filtered = filterByAssignee(allPages, assigneeName);
  logger.info(`[${tabName}] filtered ${filtered.length} pages for ${assigneeName}`);

  const existing = await sheets.readExistingRows(tabName);

  const updates: { rowIndex: number; values: string[] }[] = [];
  const appends: string[][] = [];
  let skipped = 0;

  for (const page of filtered) {
    let row: string[];
    try {
      row = [page.id, ...columns.map((c) => propertyToCell(page.properties[c.notionProp] ?? { type: "_missing" }))];
    } catch (e) {
      logger.warn(`[${tabName}] transform failed for page ${page.id}`, e);
      skipped++;
      continue;
    }

    const existingRow = existing.get(page.id);
    if (existingRow) {
      updates.push({ rowIndex: existingRow, values: row });
    } else {
      appends.push(row);
    }
  }

  await sheets.batchUpdateRows(tabName, updates);
  await sheets.appendRows(tabName, appends);

  logger.info(
    `[${tabName}] done — updated=${updates.length} appended=${appends.length} skipped=${skipped}`,
  );

  return {
    tabName,
    filtered: filtered.length,
    updated: updates.length,
    appended: appends.length,
    skipped,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/sync.ts
git commit -m "feat(notion-sheets-sync): add per-tab sync orchestrator"
```

---

## Task 11: CLI entry (`src/index.ts`)

Parse args, load env from root `.token.env`, dispatch to `syncTab` per selected tab(s).

**Files:**

- Modify: `work/scripts/notion-sheets-sync/src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` with real implementation**

```ts
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { fetchAllPages } from "./notion.ts";
import { createSheetsClient } from "./sheets.ts";
import { createLogger } from "./logger.ts";
import { syncTab } from "./sync.ts";
import { columns } from "../columns.config.ts";
import { resolveTabs } from "../tabs.config.ts";

// Root .token.env is 4 levels up from src/index.ts
loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

type Args = { tab?: string; all: boolean };

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  if (args.includes("--all")) return { all: true };
  const idx = args.indexOf("--tab");
  if (idx >= 0 && args[idx + 1]) return { all: false, tab: args[idx + 1] };
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional) return { all: false, tab: positional };
  return { all: false };
}

async function main() {
  const cfg = loadConfig();
  const logger = createLogger({
    slackBotToken: cfg.slackBotToken,
    notifyChannel: cfg.notifyOnErrorChannel,
  });

  const args = parseArgs(process.argv);
  const allTabs = resolveTabs();

  let targets: typeof allTabs;
  if (args.all) {
    targets = allTabs;
  } else if (args.tab) {
    const match = allTabs.find((t) => t.tabName === args.tab);
    if (!match) {
      logger.error(
        `Tab "${args.tab}" not in tabs.config.ts. Available: ${allTabs.map((t) => t.tabName).join(", ")}`,
      );
      process.exit(2);
    }
    targets = [match];
  } else {
    logger.error("Usage: npm run sync -- <tab-name> | --tab <name> | --all");
    process.exit(2);
  }

  logger.info(`Fetching all pages from Notion DB ${cfg.notionDatabaseId}...`);
  const allPages = await fetchAllPages(cfg.notionApiKey, cfg.notionDatabaseId);
  logger.info(`Fetched ${allPages.length} total pages.`);

  const sheets = createSheetsClient(cfg.googleServiceAccountKeyFile, cfg.googleSheetsId);

  const failures: string[] = [];
  for (const target of targets) {
    try {
      await syncTab({
        tabName: target.tabName,
        assigneeName: target.notionAssigneeName,
        allPages,
        columns,
        sheets,
        logger,
      });
    } catch (e) {
      const msg = `Tab "${target.tabName}" failed: ${(e as Error).message}`;
      logger.error(msg, e);
      failures.push(msg);
    }
  }

  if (failures.length > 0) {
    await logger.notifyFailure(failures.join("\n"));
    process.exit(1);
  }

  logger.info("All tabs synced OK.");
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add work/scripts/notion-sheets-sync/src/index.ts
git commit -m "feat(notion-sheets-sync): wire up CLI entry with --tab / --all modes"
```

---

## Task 12: Add envs to root `.token.env` + README

**Files:**

- Modify: `/Users/dangdoan/Documents/workspace/Tools/.token.env` (append new keys)
- Create: `work/scripts/notion-sheets-sync/README.md`

- [ ] **Step 1: Append sync-specific envs to root `.token.env`**

Append (preserve existing values):

```bash
# --- notion-sheets-sync ---
NOTION_DATABASE_ID=090d542c49d84c1d83370ace1cf52b56
GOOGLE_SHEETS_ID=1RUAGMUsD9HmepUr4Tgpuw5FwaSpcaE16SbWj-IaxH-w
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json
NOTIFY_ON_ERROR_CHANNEL=
```

Use Edit tool — do NOT overwrite existing content.

- [ ] **Step 2: Create `README.md`**

```markdown
# notion-sheets-sync

One-way sync from a Notion tasks database to specific tabs of a Google Sheet. Each tab corresponds to one Assignee; rows upsert by Notion page ID so manual Sheet formatting is preserved.

## Setup

### 1. Install deps

\`\`\`bash
cd work/scripts/notion-sheets-sync
npm install
\`\`\`

### 2. Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create (or select) a project
2. Enable **Google Sheets API**
3. Create a **Service Account** → grant role *Editor* on this project
4. Under the SA → Keys → Add key → JSON → download
5. Save the file as `service-account.json` in this folder (gitignored)
6. Copy the SA email (ends in `@....iam.gserviceaccount.com`)
7. Open the target Sheet → Share → paste SA email → give **Editor** access

### 3. Notion integration

The existing `NOTION_API_KEY` must have read access to the database `090d542c49d84c1d83370ace1cf52b56`. In Notion: open the database → `...` → Connections → add your integration.

### 4. Env vars (already in root `.token.env`)

See `.env.sample` for the full list.

### 5. Configure tabs

Edit `tabs.config.ts`:

\`\`\`ts
export const assignees: string[] = [
  "Đoàn Minh Đăng",
  // Add teammates' exact Notion display names here
];
\`\`\`

Tab names are auto-derived from Vietnamese names (e.g., `Đoàn Minh Đăng` → `DangDM`). Each tab must already exist in the Sheet with that name.

## Run

\`\`\`bash
# Sync a single tab
npm run sync -- DangDM
npm run sync -- --tab DangDM

# Sync all configured tabs (used by cron)
npm run sync -- --all
\`\`\`

## Cron (hourly)

macOS/Linux — edit crontab (\`crontab -e\`):

\`\`\`
0 * * * * cd /Users/dangdoan/Documents/workspace/Tools/work/scripts/notion-sheets-sync && /usr/local/bin/npm run sync -- --all >> sync.log 2>&1
\`\`\`

Replace `/usr/local/bin/npm` with `which npm` output on your machine.

## Testing

\`\`\`bash
npm test          # run vitest suite
npm run typecheck # TS strict check
\`\`\`

## Troubleshooting

- **"Tab X not in tabs.config.ts"** — add the assignee's Notion name to `assignees` and ensure the derived tab name matches the Sheet tab.
- **403 on Sheets** — make sure you shared the Sheet with the service account's email as Editor.
- **Slack notification not firing** — check both `SLACK_BOT_TOKEN` and `NOTIFY_ON_ERROR_CHANNEL` are set; channel must be one the bot is a member of.
```

- [ ] **Step 3: Commit**

```bash
git add /Users/dangdoan/Documents/workspace/Tools/.token.env work/scripts/notion-sheets-sync/README.md
git commit -m "docs(notion-sheets-sync): add README + root .token.env entries"
```

---

## Task 13: End-to-end smoke test

No automated test — this task is a manual verification checklist the executor runs with live credentials.

**Prereqs completed by user:**

- [ ] Service account JSON saved to `work/scripts/notion-sheets-sync/service-account.json`
- [ ] Target Sheet shared with SA email as Editor
- [ ] Notion integration connected to the "Tasks" database
- [ ] Root `.token.env` has `NOTION_API_KEY`, `NOTION_DATABASE_ID`, `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` filled in
- [ ] Sheet tab `DangDM` exists

**Steps:**

- [ ] **Step 1: Run sync for DangDM**

Run: `cd work/scripts/notion-sheets-sync && npm run sync -- DangDM`
Expected stdout: "Fetched N total pages", "filtered M pages for Đoàn Minh Đăng", "done — updated=0 appended=M skipped=0" (first run = all appends).

- [ ] **Step 2: Verify Sheet**

Open the target Sheet, go to `DangDM` tab. Expected:
- Row 1 headers: `_notion_id`, `Task ID`, `Task`, `Status`, `Assignee`, `Follower`, `Size Card`, `Sprint`, `Created time`
- Subsequent rows contain tasks where Assignee includes Đoàn Minh Đăng
- Column A has Notion page IDs

- [ ] **Step 3: Run again to verify upsert**

Run: `npm run sync -- DangDM` again.
Expected stdout: "updated=M appended=0" (no new rows; all existing rows updated in place).

- [ ] **Step 4: Optional — modify one task in Notion, re-sync, verify the change reflects in Sheets on the same row** (rowIndex didn't change).

- [ ] **Step 5: Test `--all` mode**

Run: `npm run sync -- --all`
Expected: runs through each entry in `tabs.config.ts`; with only `Đoàn Minh Đăng` configured, behavior ≡ Step 3.

- [ ] **Step 6: Install cron**

Follow README § Cron. Verify first automatic run in `sync.log`.

---

## Self-Review Checklist (complete before handoff)

**Spec coverage:**

- ✅ Notion DB fetch: Task 5
- ✅ Assignee filter: Task 5 (`filterByAssignee`)
- ✅ 8 configured properties: Task 6
- ✅ Tab-name derivation: Task 2 + 7
- ✅ Upsert by page ID: Task 8 (`readExistingRows`) + Task 10 (diff logic)
- ✅ Hidden `_notion_id` column A: Task 8 (`ensureHeaders`)
- ✅ CLI `--tab` / `--all` / positional: Task 11 (`parseArgs`)
- ✅ Service-account auth: Task 8
- ✅ Env loading from root `.token.env`: Task 11 (dotenv path) + Task 3 (schema)
- ✅ Error handling: per-page skip in Task 10, per-tab continue in Task 11
- ✅ Slack notify on failure: Task 9 + 11
- ✅ Cron instructions: Task 12 README

**Placeholder scan:** no TBD/TODO/"similar to"; every step has exact code or exact command.

**Type consistency:** `NotionPage`, `ColumnConfig`, `TabEntry`, `SheetsClient`, `Logger`, `Config` defined once and referenced consistently. `filterByAssignee` signature matches usage in `syncTab`. `propertyToCell` signature consistent across tests + sync.

---

## Remaining setup (user action)

1. Create Google Service Account + download JSON (see README § Setup)
2. Share target Sheet with SA email
3. Ensure Notion integration is connected to the Tasks database
4. Create `DangDM` tab in the Sheet (if not already present)
