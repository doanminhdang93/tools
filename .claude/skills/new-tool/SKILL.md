---
name: new-tool
description: Use when the user wants to create, scaffold, start, or set up a new tool in this workspace. Creates the folder, applies the right template from shared/templates/, and generates a standard README.
---

# Creating a new tool in this workspace

Use this skill when the user says things like "tạo tool mới", "create a new tool", "scaffold X", "start a tool for Y", or similar.

## Step 1 — Clarify (one question at a time)

Ask these in order, waiting for each answer:

1. **Purpose**: `work` (company) or `personal` (daily life)?
2. **Type**: `cli`, `web`, `scripts`, `extensions`, `scrapers`, or `utilities`?
3. **Name**: folder name in `kebab-case` (e.g., `excel-diff`, `jira-reporter`)
4. **Language**: JavaScript/TypeScript (default) or another (Python/shell/...)?

Skip a question only if the user already gave the answer explicitly.

## Step 2 — Check templates

Look in [shared/templates/](../../../shared/templates/) for a matching boilerplate:
- `node-cli-template/` for Node.js CLI
- `react-vite-template/` for React web tools
- `node-script-template/` for automation scripts
- `python-script-template/` for Python scripts
- etc.

If a matching template exists, copy it. If not, scaffold a minimal structure (see Step 4).

## Step 3 — Create folder

Path: `<purpose>/<type>/<name>/`

Example: `work/cli/jira-reporter/`

## Step 4 — Scaffold files

Convention: each tool folder contains its own `README.md` at the root, plus a `docs/` subfolder for longer documentation (design specs, architecture notes, API docs). There is NO top-level `docs/` folder in the workspace — all documentation lives inside the tool it describes.

Always create:

- `README.md` at tool root — short overview, how to run, deps (see template below)
- `docs/` subfolder — empty to start; add `design.md` or similar when the tool grows

README template:

```markdown
# <tool-name>

<one-line description of what it does>

## Usage

<how to run it — command line, URL, install steps>

## Dependencies

<runtime, key packages>

## Notes

<anything else worth knowing>
```

Then add language-specific scaffolding:
- **Node/JS**: `package.json` with `"name": "<tool-name>"`, `"private": true`, basic scripts. Entry file `index.js` or `src/index.ts`.
- **CLI**: shebang (`#!/usr/bin/env node`) on the entry file.
- **Web**: minimal `index.html` if not using a framework; use Vite for React.
- **Python**: `main.py`, `requirements.txt`, mention using `.venv/`.
- **Shell**: `.sh` file with shebang and `chmod +x`.

If the tool needs API keys, remind the user they live in the root `.token.env` (gitignored).

## Step 5 — Report back

Tell the user:
1. Where the tool was created (full path)
2. How to run it (exact command)
3. What to do next (install deps, start coding)

## Don't do

- Don't set up a monorepo link. Sharing is copy-on-need via `shared/`.
- Don't add a LICENSE file to the tool folder (root LICENSE covers it).
- Don't create `.gitignore` inside the tool folder unless it truly needs overrides — root `.gitignore` already covers common cases.
- Don't over-scaffold. Start minimal; the user will grow it.
