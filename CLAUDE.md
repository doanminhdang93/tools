# CLAUDE.md

Context for Claude when working in this Tools workspace.

## What this workspace is

A personal collection of tools — both for company work and daily personal use. Owner is a ReactJS/NodeJS developer who writes JS/TS by default but picks other languages when they fit better (Python for data/scraping, shell for quick automation, etc.).

## Structure

- `work/` and `personal/` — each contains 6 type folders: `cli/`, `web/`, `scripts/`, `extensions/`, `scrapers/`, `utilities/`
- `shared/` — reusable code: `snippets/`, `configs/`, `helpers/`, `templates/`
- `sandbox/` — quick experiments, not committed to keeping
- `archive/` — old tools kept for reference

Each tool lives in its own folder at `<purpose>/<type>/<tool-name>/` and is fully self-contained: own `README.md`, own deps, own `docs/` subfolder for longer documentation (design, architecture, notes). There is NO top-level `docs/` folder — all documentation lives inside the tool it belongs to, so tools can be moved or archived as a unit.

## Conventions

- **Default stack**: JavaScript/TypeScript (Node.js + React). Other languages per-tool when they fit better.
- **Coding standards**: every piece of code in this workspace follows `.claude/skills/writing-code/SKILL.md` — clear full names (no abbreviations), flat control flow (early returns, lookup maps over long `if/else`), `async/await` (no callback hell), small reusable units. Invoke the `writing-code` skill whenever writing or editing code.
- **Every tool has a README.md** with: one-line description, how to run, dependencies, usage example.
- **Before creating a new tool**: check `shared/templates/` for matching boilerplate.
- **Before writing a helper**: check `shared/helpers/` and `shared/snippets/` first.
- **API keys** go in `.token.env` (gitignored). Never hardcode keys in tool code or commit them.
- **No monorepo** — tools are independent. Use `shared/` as a copy-on-need library, not a linked workspace.

## When the user asks to create a new tool

Use the `new-tool` skill at `.claude/skills/new-tool/SKILL.md`. The flow:

1. Ask purpose (work/personal), type (cli/web/scripts/extensions/scrapers/utilities), name
2. Check `shared/templates/` for matching boilerplate
3. Scaffold at `<purpose>/<type>/<tool-name>/`
4. Create `README.md` at the tool root, and `docs/` subfolder for longer docs (design, architecture, notes)

## What NOT to do

- Don't restructure the folders without asking — the 2-level (purpose → type) layout is intentional.
- Don't set up pnpm/npm workspaces — sharing is deliberately simple via `shared/`.
- Don't add LICENSE headers to files — this workspace is private (UNLICENSED).
- Don't create docs unless asked — except the README.md inside each tool folder.
