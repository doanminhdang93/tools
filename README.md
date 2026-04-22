# Tools

Personal workspace for tools that support company work and daily life.

## Structure

| Folder | Purpose |
| ------ | ------- |
| [work/](work/) | Tools for company work |
| [personal/](personal/) | Tools for personal daily use |
| [shared/](shared/) | Reusable code across tools (snippets, configs, helpers, templates) |
| [sandbox/](sandbox/) | Quick experiments, POCs |
| [archive/](archive/) | Old tools kept for reference |

**Docs convention:** there is no top-level `docs/` folder. Every tool's documentation lives **inside that tool's own folder** — `README.md` at the tool root, and a `docs/` subfolder for longer docs (design, architecture, notes). This keeps each tool self-contained and movable.

### Tool types (inside `work/` and `personal/`)

| Type | What goes here |
| ---- | -------------- |
| `cli/` | Command-line tools run from terminal |
| `web/` | Browser-based tools with a UI |
| `scripts/` | Automation scripts (cron, one-shot) |
| `extensions/` | Browser extensions, userscripts |
| `scrapers/` | Data crawling / scraping tools |
| `utilities/` | Small helpers, snippets, one-file tools |

## Creating a new tool

1. Pick location: `<work|personal>/<type>/<tool-name>/`
2. Check [shared/templates/](shared/templates/) for a matching boilerplate
3. Copy the template → rename folder → fill in details
4. Add a `README.md` in the tool folder describing what it does and how to run it

Or ask Claude: "tạo tool mới ..." — the `new-tool` skill in [.claude/skills/](.claude/skills/) will walk through it.

## API keys

Put keys in `.token.env` (gitignored, never committed). See [.token.env.example](.token.env.example) for format.

## Default stack

JavaScript / TypeScript (Node.js + React). Other languages are fine per-tool when they fit better.
