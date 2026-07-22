---
name: CODE_REVIEW.md — prototype audit vs SPEC
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-BUILD-PLAN
---

The 2026-07 line-cited audit of the pre-SPEC prototype: per-file keep/rework/rewrite verdicts plus the salvage/delete/net-new lists Phase 1 executes against.

# Full Code Review — Existing Implementation vs SPEC.md

**Date:** 2026-07-07 · **Scope:** Go compiler (`compiler/`), client runtime (`client-runtime/`) · **Yardstick:** [[DOC-SPEC]]

## Executive summary

The existing implementation is a pre-SPEC prototype. **None of it has ever run end-to-end**: the Go module didn't build (missing `go.sum`, missing `os` import), the template parser cannot parse even its own dialect, and the runtime doesn't export any of the four entry points the canonical app imports. This is expected — `project_plan.md` said as much — but the review makes it concrete: **Phase 1 (runtime kernel) and Phase 2 (compiler) are mostly greenfield, reusing ~15–25% of existing code as skeletons.** No finding changes the plan's shape or estimate; several findings confirm the "runtime first, compiler second" ordering.

### Verdict table

| File | Verdict | Survives | Top issue |
|---|---|---|---|
| `compiler/cmd/puzzle/main.go` | rework | ~70% | `watch`→`dev`, `--src ./src`→`./app`, build should default to production |
| `compiler/internal/parser/lexer.go` | rewrite | ~20% | Block headers never terminated at `}`; half the lexer is dead code |
| `compiler/internal/parser/parser.go` | rewrite | ~10% | Cannot parse any block correctly; wrong dialect; not HTML-aware |
| `compiler/internal/compiler/compiler.go` | rewrite | ~15% | `bundleRuntime` emits invalid JS; codegen shape contradicts SPEC §4 |
| `compiler/internal/watcher/watcher.go` | rework | ~50% | Didn't compile (missing `os` import); reload notification is a no-op |
| `client-runtime/main.js` | rework (heavy) | ~15% | None of the four SPEC exports exist; config keys silently ignored |
| `client-runtime/router/router.js` | rework | ~55% | No layout/`<Slot/>` path, no `push()`, no `meta.title`; listener leak |
| `client-runtime/views/PuzzleView.js` | rewrite | ~15% | Dead code (zero importers); `HTMLElement` base throws on construction; `data()` result discarded |
| `client-runtime/views/ViewNode.js` | rework | ~50% | `value`/boolean attrs broken (todos input/checkbox can't work) |
| `client-runtime/views/viewManager.js` | rework | ~40% | Loses DOM links after first patch cycle — UI freezes after ~2 renders |
| `client-runtime/datastore/store.js` | rework | ~30% | No models registry/defaults; `findMany` filter ignored; no collection subscriptions |
| `client-runtime/datastore/record.js` | rewrite | ~10% | Proxy design can't host `PuzzleModel` getters/methods; `subscribeView` mismatch |
| `client-runtime/filters.js` | keep | ~85% | Rename filters→formatters; a few formatter bugs |

---

## Part 1 — Go compiler

### 1.1 It has never compiled (fixed/confirmed)

- The repo had **no `go.sum`**, so `go build ./...` failed before reaching any code. Fixed on this branch (commit `ecbe6af`).
- With deps resolved, the build still fails: **`watcher.go:69: undefined: os`** — `filepath.Walk` callback uses `os.FileInfo` without importing `os`. This was flagged in `project_plan.md` and is now empirically confirmed: the CLI has never been runnable from a clean checkout.

### 1.2 The parser cannot parse blocks — empirically verified

Test: `{#each items as item}<li>{ item.name }</li>{/each}` (the parser's **own** dialect) produces:

```
each: collection="items"  item="item}<li> item.name </li>"  body: "each}"
```

The lexer never terminates a block header at `}` — after `{#`, everything up to the next `{` becomes one text token, so the header swallows following markup and the AST is garbage. Parsing the canonical `Home.pzl` "succeeds" (15 top-level nodes) only because entire `{#if}…{/if}` regions collapse into mangled header text without raising an error. **No template has ever parsed correctly.**

Additional parser/lexer findings:

- **Wrong dialect.** Supports `{#each items as item, i}`, `{#case}/{:when}`, `{#unless}`, `{#raw}`. SPEC v1 needs `{#if}/{:else}/{/if}`, `{#for item in items}`, `{#for 1...n}` — `for` is an "unknown block type" today, and `case`/`unless` were post-v1 at review time (both later shipped in v1.7 — D36/D37 — with corrected syntax/semantics; `each`/`raw` remain rejected).
- **Half the lexer is dead code**: `scanIdentifier`, `scanString`, `skipWhitespaceInExpression` are never called on any live path; 10 of 17 token types are never produced.
- **Not HTML-aware at all**: no tags, attributes, component tags, or `<puzzle-view>/<scripts>/<styles>` extraction (the whole `.pzl` file is fed to the control-flow parser, so HTML becomes escaped text). SPEC §3/§6 require an HTML-aware template parser with an attribute-value mini-grammar (inline `{#if}` in `class`).
- Filter-argument parsing is by `strings.Split(",")` — breaks on any arg containing a comma or nested parens (self-acknowledged in a comment).

### 1.3 Compiler orchestration contradicts SPEC §11

- **`bundleRuntime()` (compiler.go:54–89) emits syntactically invalid JavaScript**: it concatenates the runtime's ES modules — which contain `import`/`export` statements — inside an IIFE, then assigns `window.Puzzle = { ViewNode, … }` from identifiers that aren't in scope. It also silently `continue`s on missing files. SPEC deletes this entirely: the runtime is an npm package resolved by esbuild.
- **`compileTemplates()` walks only `views/`** — `components/` and `layouts/` are never compiled — and writes orphan `.js` files to `dist/views/` that nothing imports. SPEC: `.pzl` is handled by an esbuild `onLoad` plugin so templates join the module graph.
- **Codegen shape is wrong** (compiler.go:141–158): emits a standalone `export function render(data, __filters)` that reads `window.Puzzle.ViewNode` from a global and wraps everything in a hardcoded `div`. SPEC §4: `render()` is attached via `Component.prototype.render`, uses imports, and the root is the `<puzzle-view>` element with its attributes.
- **Expression compilation is unsound** (compiler.go:229–231): it prefixes the raw expression string with `data.` — so `{ todo.text }` inside a loop becomes `data.todo.text` (loop variables aren't on `data`), `a + b` prefixes only the first identifier, and `!x` produces `data.!x`. Real scope tracking (loop vars, `event`) is required.
- **Escape contract is a good idea, keep it**: `__filters.escape(...)` by default, `raw`/`noescape` to skip, `__missing` fallback — carry this into the rewrite (renamed to formatters).

### 1.4 CLI + watcher (rework, not rewrite)

- `watch` → `dev` per SPEC; `--src` default `./src` → `./app`; **`--production` is opt-in but SPEC says `puzzle build` defaults to production** (with `--mode development` as the override).
- Watcher bugs: `notifyReload()` is an empty placeholder and the SSE endpoint only sends `ping` every 30s — **no reload event is ever delivered, and nothing injects an `EventSource` client into `index.html`**, so live reload is cosmetic. Directory watching isn't extended when new subdirectories are created. `log.Fatal` inside the server goroutine kills the process without cleanup; `select {}` means no graceful shutdown.
- Worth keeping: the cobra command skeleton, the esbuild `BuildOptions` block, the debounce loop, and the history-API-fallback static server shape.

---

## Part 2 — Client runtime

### 2.1 The single highest-severity finding: the app can't even import

`client-runtime/main.js` exports none of the four SPEC §1 entry points. `PuzzleApp`, `PuzzleModel`, and the `Puzzle` schema-builder namespace **do not exist anywhere in the runtime** (grep-confirmed), and `views/PuzzleView.js` is never re-exported. `import { PuzzleApp } from '@magic-spells/puzzle'` fails at step zero. The model layer (`PuzzleModel` + `FieldBuilder`) is net-new code, not a refactor.

### 2.2 Two competing view classes — and the wrong one is wired in

- `views/PuzzleView.js` (the "real" class-based one) is **orphaned — zero importers**.
- The view class that actually runs is the closure-based factory inside `main.js:305` (`Puzzle.createView`) — exactly what SPEC §1 removes.
- The orphaned class **extends `HTMLElement`**, so `new Subclass(ctx)` throws `Illegal constructor` unless each compiled component is registered via `customElements.define()` — which nothing does, and the shared-tag `register()` guard means only the first component could ever register. `disconnectedCallback` also destroys the component on any DOM detach (a reparent kills it permanently).

> **Recommended SPEC addition:** `PuzzleView` should be a **plain class** (ctx + private data + subscriptions + update scheduling); mounting into DOM is the ViewManager's job. Web components buy nothing in the SPEC's compile-to-render-function model and break construction.

### 2.3 The reactive pipeline is broken at four independent points

Any one of these kills the todos app; together they mean SPEC §4/§8 reactivity is unimplemented:

1. **`data()`'s return value is discarded** (PuzzleView.js:28) — called once in the constructor as `this.data({}, {})`: no params, no props, no async await, result thrown away, never re-run.
2. **Subscription is a silent no-op** — `PuzzleView.subscribe()` calls `record.subscribeView(...)` but `Record` implements `subscribe(...)`; a `typeof` guard swallows the mismatch (PuzzleView.js:173 vs record.js:69).
3. **Queries never subscribe and creates never notify** — no "currently evaluating component" tracking in `findOne`/`findMany`, and no collection-level subscriptions exist at all (subscribers live only on individual records), so `createRecord` can never inform a component that queried `findMany('todo')`. New todos would never appear.
4. **Notification calls `reRender()` with stale data instead of re-running `data()`** (record.js:79) — and even the re-render freezes, because…

### 2.4 The virtual DOM freezes after ~2 renders

`ViewManager.render()` diffs old vs new tree, then **replaces `currentTree` with the new tree whose nodes have `liveElement === null`** — only nodes materialized via REPLACE/ADD_CHILD get DOM links. Next render, every patch targets null-liveElement nodes and the guards silently skip them: first render works, the second applies, the third onward is a silent no-op. The diff must transfer `liveElement` pointers across renders (or patch the retained tree).

Other view-layer findings, ranked:

- **"Key-based reconciliation" is fiction**: key maps are built and never read; matching is index-based; no MOVE patch; the WeakMap fallback keys freshly-allocated vnodes so it mints new keys every render. The todos `{#for todo in filteredTodos}` needs real `todo.id` keying.
- **Form bindings can't work**: `value` is skipped at element creation (the todos input never gets its value), and boolean attributes use `setAttribute('checked', false)` — truthy-present, so the todo checkbox could never uncheck. `value`/`checked`/`disabled` need property assignment.
- **No component vnodes and no `<Slot/>`** — only host elements and text exist; `Default.pzl`'s `<Slot/>` and any `<Button/>`-style component tag have no rendering path.
- ADD_CHILD indexes `element.children` with an index counted over `childNodes` — inserts land wrong in mixed text/element content.
- `viewFn(data, filters)` calling convention bakes in the removed functional-view world; the manager must call `view.render()` (prototype method) instead. `BindingRegistry` is dead code.
- **Render-time TypeError on any interpolation**: viewManager passes the `FilterRegistry` instance where compiled code needs the raw function map — `__filters.escape` is `undefined`. (One-line fix, but proof the escape path never ran.)

### 2.5 App class and router

`main.js` (`Puzzle` class): beyond the mandated rename/removals, the **config keys don't match SPEC §2 at all** — it reads `container`/`filters`/`beforeMount`/`mounted`/`afterMount`/`autoMount`/`enableDevtools`. Consequences for the canonical app: `target` ignored (works only by coincidental default), `formatters` silently dropped, `models` never reaches the Store. EventBus, `utils`, devtools global, and `window.Puzzle` are all deferred surface to delete.

`router.js` is the healthiest runtime file — path→regex compilation, param extraction, history-API handling, and query parsing all survive. Needs:

- **Layout + `<Slot/>` composition** (doesn't exist; `meta.layout` is stuffed by main.js and never read), **`meta.title`** (never set), **`router.push()`** (only `navigate()` exists).
- Bug: `start()` adds `this.handleClick.bind(this)` but `stop()` removes the unbound original — **document-level click listener leaks** per start/stop cycle.
- Bug: `handleClick` swallows cmd/ctrl/middle-click and hijacks `mailto:`/`tel:` links — missing the standard modifier/button/protocol guards.
- Bug: `pushState` happens before `match()`; a failed/cancelled navigation leaves the URL and the rendered view out of sync; `match()` is async but never awaited.
- Params aren't `decodeURIComponent`-ed; no NotFound-route convention (404 is a console.warn).
- The router self-registers `popstate` correctly — the old example-app's manual `handlePopState` wiring was calling a method that never existed.

### 2.6 Datastore and formatters

`store.js`: keep the dirty-set + rAF flush batching core. Everything else is missing or wrong: no models registry (constructor takes nothing), no schema defaults or `.primary()` handling in `createRecord` (a created todo has `completed: undefined`), `findMany`'s options argument silently dropped, no `record.destroy()` path (only `store.deleteRecord`), `deleteRecord` notifies synchronously *before* deleting, `load()` throws `ReferenceError` unconditionally (references a commented-out variable), localStorage persistence is stubbed out, and an undocumented, asymmetric pluralization heuristic in `_getTypeMap` should be deleted.

`record.js`: rewrite as the `PuzzleModel` base class. The generic Proxy-record design cannot host class getters (`get isActive()`) or instance methods (`toggle()`) from user model classes — SPEC §7's contract is that a record **is** an instance of the registered model. Carry over: `update()` semantics (but return the record), dirty-marking on set. Fix in the rewrite: identity-field clobbering via the set trap, `toJSON` polluting round-trips.

`filters.js`: **keep** — the registry design and built-in coverage (all documented formatters exist) are close to shippable. Required: the **filters→formatters rename** across class/ctx key/config key (SPEC §2/§10 — today `this.ctx.formatters` is `undefined` everywhere). Small fixes: `number_with_delimiter` truncates decimals (`toFixed(0)` + dead split logic), `round` returns a string, `replace` replaces first occurrence only (Liquid replaces all), `null`/`undefined` render as literal `"null"`/`"undefined"` strings, `timeago` has an unreachable branch.

---

## Part 3 — Cross-cutting decisions & follow-ups

1. **filters → formatters, everywhere** — runtime class, ctx key, config key, compiler's `__filters` parameter. Mechanical but contract-critical.
2. **Drop `extends HTMLElement`** — recommend adding to SPEC §4 (plain class; ViewManager owns DOM mounting). *Needs sign-off.*
3. **Deletion list for Phase 1, day one**: `Puzzle.createView` + inner view class (main.js:291–521), EventBus + `$events`, `utils`/`ctx.utils` exposure, devtools hook, `window.Puzzle` global, `BindingRegistry`, live animation code in PuzzleView, `case`/`unless`/`raw` parser paths, pluralization heuristic in store.
4. **Net-new code (no existing base):** `PuzzleModel`, `Puzzle` field builders, models-registry wiring, query auto-subscription + `data()` re-run scheduling, layout/`<Slot/>` composition, component vnodes, event-handler wiring per SPEC §5, HTML-aware template parser, esbuild `onLoad` plugin, SSE reload event + client injection.
5. **Ideas worth salvaging from doomed code**: the `_isRendering`/`_needsRender` re-entrancy guard and the array-aware auto-(un)subscribe from main.js's inner class; `setData`'s rAF batching + `beforeUpdate`/`afterUpdate` dispatch from PuzzleView.js; the escape/`raw`/`__missing` compiler contract.

## Part 4 — Impact on the build plan

The review **confirms the plan** rather than changing it:

- **Phase 1 ordering validated.** The runtime kernel is mostly greenfield; the hand-written compiled fixture of `Home.pzl` remains the right first artifact since nothing existing defines correct compiled output.
- **Phase 2 scope validated.** The parser/codegen is a full rewrite (it was never a working base); the esbuild-plugin architecture eliminates `bundleRuntime` and the orphan-output problem outright.
- **Estimate unchanged** (5–7 focused weeks): reuse is lower than the code volume suggests (~15–25%), but the plan already assumed prototype-grade code. The two risk areas called out in the plan — attribute-value grammar and keyed reconciliation — are confirmed as the real gaps (both currently nonexistent/fictional).
