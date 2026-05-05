# onboarding-roadmap-sync

Mirrors the X Team docs-site onboarding roadmap (Week 1–4) into the Notion master template **"[Dev] Onboarding - AOV.ai"**, supports per-task add/update, and customises duplicated copies for new developers.

- Design: [docs/design.md](docs/design.md)
- Plan: [docs/plan.md](docs/plan.md)

## Quick start

```bash
git clone <repo> && cd <repo>/work/scripts/onboarding-roadmap-sync
npm install
```

Setup once per machine:

1. Workspace-root `.token.env` must contain `NOTION_API_KEY` (the same `X Team` integration used by `notion-sheets-sync`).
2. In Notion UI, the lead opens the master template page → `...` → `Connections` → adds `X Team`.

Verify reachability:

```bash
npm run sync -- --dry-run
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run sync` | Batch sync Week 1–4 docs pages into the master template (idempotent). |
| `npm run sync -- --dry-run` | Log intent without writing to Notion. |
| `npm run sync -- --force` | Rewrite body of every matched task even if hash unchanged. |
| `npm run sync -- --week N` | Limit batch sync to a single week (1–4). |
| `npm run add-task -- --url <docs-url> --week <N>` | Add or refresh one task. Prompts when flags missing. |
| `npm run new-dev -- --page <duplicated-page-url> --name "<dev name>"` | Customise a Notion-duplicated copy of the master template. Renames title and resets all Status to `Not started`. |
| `npm test` | Unit tests (cheerio fixture-based, no Notion calls). |
| `npm run typecheck` | TypeScript compile check. |

## Provisioning a new developer

1. In Notion UI, open the master template → `...` → **Duplicate**. Notion clones the inline DB and every task page faithfully.
2. Copy the duplicated page's URL.
3. Run `npm run new-dev -- --page <copied-url> --name "Anh Nguyen"`.
4. In Notion UI, share the new page with the developer (Notion API can't share pages on behalf of an integration).

## How sync works

The tool fetches the docs-site sidebar from `SIDEBAR_SEED_URL` (a known training-docs page; the docs homepage doesn't render the Week sidebar), parses Week 1–4 entries, and for each docs URL:

- If no Notion task with that `Source URL` exists → create one (Name from docs page title, Week tag, Status `Not started`).
- If one exists and `Source Hash` differs → wipe its body, append new blocks, update the hash. **Never** touches Status, tag, or Name.
- If one exists and the hash matches → skip.

Tasks left in the DB whose `Source URL` is no longer in the sidebar are logged as `orphans` (not auto-archived — the lead resolves manually).

## Source layout

See [docs/design.md](docs/design.md) for the full architecture spec.
