---
name: writing-code
description: Use whenever writing or editing code anywhere in this workspace. Defines coding standards: clear names, flat control flow, async/await over callbacks, small reusable units. Applies to all languages.
---

# Writing code in this workspace

These are non-negotiable coding standards for every tool in this workspace. Apply them to JS, TS, Python, shell, and anything else.

## 1. Names

**Clear, full names. No abbreviations.**

| Bad | Good |
|-----|------|
| `cfg` | `config` |
| `res` | `response` |
| `req` | `request` |
| `err` | `error` |
| `ctx` | `context` |
| `msg` | `message` |
| `idx` | `index` |
| `prop` | `property` |
| `arr` | `items` / `pages` / the real thing |
| `obj` | the real thing |
| `tmp` | `draft` / real purpose |
| `val` | the real thing |
| `fn` | `handler` / `callback` / real role |

**Exceptions (idiomatic, keep short):**

- Loop counters: `i`, `j` when inside a tight 2-3 line loop
- Single-letter in a pipeline where the domain is obvious: `.map((page) => ...)` — but `page`, not `p`
- Math: `x`, `y`, `n` in a narrow math helper

**Names carry meaning:**

- Functions: verbs. `fetchPages`, `deriveTabName`, `buildRow`.
- Booleans: questions. `isEmpty`, `hasAssignee`, `shouldNotify`.
- Collections: plural. `pages`, `rows`, `columns`.
- Single items: singular. `page`, `row`.

## 2. Flat control flow — minimize `if/else`

**Prefer early returns (guard clauses) over nested `if/else`:**

```ts
// Avoid
function getName(user) {
  if (user) {
    if (user.profile) {
      return user.profile.name;
    } else {
      return "Unknown";
    }
  } else {
    return "Unknown";
  }
}

// Prefer
function getName(user) {
  if (!user) return "Unknown";
  if (!user.profile) return "Unknown";
  return user.profile.name;
}
```

**Prefer lookup maps / dispatch tables over long `if/else if` chains:**

```ts
// Avoid
if (type === "title") return handleTitle(x);
else if (type === "rich_text") return handleRichText(x);
else if (type === "select") return handleSelect(x);
// ... 10 more branches

// Prefer
const handlers = {
  title: handleTitle,
  rich_text: handleRichText,
  select: handleSelect,
};
return handlers[type]?.(x) ?? "";
```

**`switch` is acceptable when:**

- Each case is genuinely distinct logic
- An exhaustiveness check matters (e.g., TS discriminated unions)
- A lookup map would lose type safety

**Avoid `else` after `return`, `throw`, `continue`, `break`:**

```ts
// Avoid
if (error) {
  return fail;
} else {
  return ok;
}

// Prefer
if (error) return fail;
return ok;
```

## 3. Async — no callback hell

**Always `async/await`. Never nested callbacks:**

```ts
// Avoid
fetchUser(id, (user) => {
  fetchPosts(user.id, (posts) => {
    render(user, posts);
  });
});

// Prefer
const user = await fetchUser(id);
const posts = await fetchPosts(user.id);
render(user, posts);
```

**Parallel work → `Promise.all`, never sequential waits when independent:**

```ts
// Avoid — 2× slower than needed
const user = await fetchUser(id);
const settings = await fetchSettings(id);

// Prefer
const [user, settings] = await Promise.all([fetchUser(id), fetchSettings(id)]);
```

**Don't mix `.then()` chains with `async/await` in the same function.** Pick one per scope; `async/await` is the default.

## 4. Small units, single responsibility

- **One function = one purpose.** If its name needs "and" (`fetchAndTransformAndSave`), split it.
- **Target ≤ 30 lines per function**, ≤ 150 lines per file. Soft limits — when exceeded, ask: is this doing too much?
- **Pure > impure.** Separate IO (API calls, file reads) from logic (transforms, decisions). Pure functions are trivially testable.
- **Input → output, not mutation.** Return new values; don't mutate parameters unless the function is explicitly named for it (`pushX`, `clearY`).

## 5. Reusability — but not prematurely

- **Write it once inline.** On the second duplicate, extract. On the third, definitely.
- **Don't design for hypothetical reuse.** A `genericDataHandler<T, K, V>` that's used in one place is worse than a concrete `syncTab`.
- **Shared code lives in `shared/`** (workspace root). Tool-local helpers stay in the tool's own folder.
- **Interfaces over concretes** only when there's a real second implementation coming. Otherwise direct calls.

## 6. Error handling — at boundaries, not sprinkled

- **Catch where you can act.** Top-level (CLI entry), or at a boundary where a fallback is meaningful. Don't `try/catch` in every function just to rethrow.
- **Fail loud by default.** Silent `catch (e) {}` is a bug magnet — if you truly want to ignore an error, comment *why*.
- **Error messages name the context:** `Sheets batchUpdate failed for tab DangDM: <cause>` beats `Error: something broke`.

## 7. Comments — only for WHY

- Default: no comments. Good names do the talking.
- Write a comment only when the code alone cannot explain **why** — a hidden constraint, a workaround for a specific bug, a deliberate trade-off.
- Never comment **what** — if you feel the urge, rename the variable/function instead.
- Never leave "TODO: fix later" without a tracking issue; delete or file.

## 8. Types — strict, no `any`

(TS / Py type hints)

- No `any` in TS. Prefer `unknown` + narrowing at boundaries.
- Pure data types (`interface` / `type`) live next to the function that owns them; shared types in `types.ts`.
- Python: type hints on function signatures, even for `__init__`.

## 9. Test structure

- **Test pure functions thoroughly** — they are the easy wins.
- **Mock IO boundaries only** — don't mock your own internals.
- **Test names describe behavior, not implementation:** `"derives DangDM from Đoàn Minh Đăng"` beats `"test_deriveTabName_case_3"`.

## 10. File layout conventions

- `src/<thing>.ts` — one concern per file, matches export name
- `src/__tests__/<thing>.test.ts` — mirrors `src/<thing>.ts`
- `*.config.ts` — static configuration, no logic
- `index.ts` — thin wiring: compose modules, no business logic

---

## Quick pre-commit checklist

Before claiming a task done, answer:

1. Any `if/else` I can flatten with an early return?
2. Any abbreviated names I can expand?
3. Any callback I can convert to `async/await`?
4. Any function doing two things? Split it.
5. Any comment explaining **what**? Rename, then delete the comment.
6. Any silent `catch`? Add a log or rethrow.
