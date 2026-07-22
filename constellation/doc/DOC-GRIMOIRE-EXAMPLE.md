---
name: Grimoire (examples/grimoire) — Notion-clone block editor example
kind: reference-app
status: verified
verified_at: '2026-07-22T00:04:05.709Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
connections:
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D45-BACKSPACE-DELETE-FILTERS
  - DOC-CHIRP-EXAMPLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - FILE-EXAMPLES-GRIMOIRE-APP-APP
  - FILE-EXAMPLES-GRIMOIRE-APP-ROUTES
  - FILE-EXAMPLES-GRIMOIRE-APP-MODELS-BLOCK
  - FILE-EXAMPLES-GRIMOIRE-APP-MODELS-PAGE
  - FILE-EXAMPLES-GRIMOIRE-APP-LAYOUTS-DEFAULT
  - FILE-EXAMPLES-GRIMOIRE-APP-VIEWS-DOC
  - FILE-EXAMPLES-GRIMOIRE-APP-COMPONENTS-BLOCK
  - FILE-EXAMPLES-GRIMOIRE-APP-LIB-CARET
  - FILE-EXAMPLES-GRIMOIRE-APP-LIB-FOCUS
  - FILE-EXAMPLES-GRIMOIRE-README
notes:
  - kind: verified
    text: >-
      Verified end-to-end at a17a949. Evidence: three phased Opus builds each browser-verified
      (scaffold: seed/routing/persistence/reactive toggles; editor core: 40+ assertions on
      typing/split/merge/convert/arrow-nav/paste/title echo; features: 50/50 checks on slash
      filter+convert+strip, Escape-leaves-text, divider-below on non-empty, turn-into re-seed with
      no stale checkbox, drag with unsaved-text survival, cancel, Tab indent + renumbering) plus an
      INDEPENDENT lead Playwright smoke (13/13: seed, typing, slash→heading2 conversion with query
      strip, backspace-merge, reload persistence, turn-into→quote, zero console errors) which caught
      and fixed a menu-off-viewport bug (now clamps + flips above anchor). Two real bugs found by
      verification overall: the turn-into Enter double-dispatch into the focused island (fixed via
      capture-phase stopPropagation) and the menu positioning. npm test 285/285 with build:grimoire
      in pretest; production build 23.3 KB gzip.
    sha: a17a949e4853d7b44b122d401d4c176251c72385
  - kind: verified
    text: >-
      Re-verified at 512fd2c after the origin/main merge and the islands renumber (v1.10→v1.13,
      D41/D42→D44/D45; the example's comments/README now cite the new numbers). The 13-check lead
      Playwright smoke re-ran green against the merged runtime (main's v1.10-v1.12 router/formatter
      changes coexist cleanly); 327 vitest with build:grimoire in pretest.
    sha: 512fd2c37cf7cef74a8eed131545a7c479eb4176
---

# Grimoire (examples/grimoire)

A Notion clone — pages in a sidebar, documents made of typed blocks, every
text surface an always-on `contenteditable`. The **motivating app for v1.13**
([[DECISION-D44-DOM-ISLANDS]] / [[DECISION-D45-BACKSPACE-DELETE-FILTERS]]) and
the reference for building editors on Puzzle: it copies Notion's actual
architecture — many small per-block uncontrolled contenteditables over a JS
document model, NOT one big editable surface and NOT a framework-managed
binding (React refuses to manage contenteditable children; the island is
Puzzle's honest equivalent).

## The editing architecture (read this before touching editor code)

- **One island per text run.** Each block's `[data-block-text]` div and the doc
  title span are `contenteditable="true" island`. The template seeds them; the
  browser owns them afterward. The store stays the source of truth for
  everything EXCEPT the currently-mounted island DOM.
- **One-way flow (D44).** `@input` → `props.sync(textOf(el))` → store, per
  keystroke. Doc's `data()` re-runs on every store change and repaints — safely,
  because the patcher never reconciles island children. Programmatic text
  changes (merge, split truncation, slash-query stripping) must update the
  island DOM **imperatively** AND the store.
- **Keyed `{#case}` branches = turn-into correctness.** Every block-type branch
  root carries a distinct static `key`, so a type change fails `sameNode`,
  REPLACES the branch, and re-seeds a fresh island from the template. Without
  the keys, two unkeyed `div` roots pair as the same node and carry the old
  frozen island children across the type change (stale checkbox structure
  inside a "paragraph"). The doc title island is `key={ page.id }` for the same
  reason across page switches.
- **Focus routing (lib/focus.js).** Child component mounts are async (a
  microtask after the parent patch), so a caret can't be placed synchronously
  in a block that doesn't exist yet. One pending request; two resolvers: the
  target Block consumes it in its own `mounted()`/`afterUpdate()` (fast path),
  and Doc's `afterUpdate()` runs a rAF-retry DOM sweep (backstop).
  **Gotcha — the same-id re-seed race:** when the focus target is the block
  being CONVERTED (type change → keyed branch re-seed), do NOT flush the sweep
  synchronously — it grabs the stale island still in the DOM and the caret dies
  with it. Park the request; the re-rendered block consumes it against the
  fresh island.
- **Doc owns store/order math, Block owns caret math.** Callback-prop protocol
  from Doc to each Block: `@sync/@split/@mergeUp/@navigate/@convert/@remove/@toggle`
  (call-expression form closes over `block.id`; `event` carries the child's
  payload). Integer reindex on structural changes (kanban's pattern). Blocks
  receive ONLY primitives (records mutate in place — record props go stale
  behind the shallow compare).
- **Conditional key intercepts stay in handlers** (D45): Backspace-merge fires
  only at `atStart(el)` — the handler guards and calls `preventDefault()`
  itself; `:prevent` would swallow ordinary deletion.
- **Menus live in Doc's reconciled tree, never inside an island** (components/
  live DOM in browser-owned subtrees are frozen/forbidden). The slash menu is
  fed by two Block→Doc channels: `@slash` (open/query/close lifecycle the
  island detects from its own caret+text) and `@slashKey` (Arrow/Enter/Escape
  rerouted from caret motion while `slashActive`); the Turn-into menu is
  Doc-owned off the ⠿ handle (a no-move pointerup = click) and driven by a
  CAPTURE-phase document keydown that `stopPropagation()`s the keys it acts on
  — without that, Enter reached the still-focused island and split a block
  while Delete removed one (found in verification). Menu position clamps to
  the viewport and flips above the anchor near the bottom edge (found by the
  lead's independent smoke). Slash selection strips the typed `/query` from
  island DOM + store before converting.
- **Drag reorder is the kanban Board machine** (threshold → ghost →
  placeholder view-model spliced in `data()` → midpoint hit-test → FLIP in
  `afterUpdate`, gated to drag-active so per-keystroke renders stay cheap →
  splice + reindex on drop). Blocks stay keyed by id so the patcher MOVES real
  DOM — island content, including unsaved in-flight typing, survives the drop.

## Framework surface exercised

- **FIRST use of `island` (v1.13, D44)** — the entire editor.
- `@keydown:backspace`/`@keydown:delete` filters (v1.13, D45), plus
  `enter`/`up`/`down` filters driving split/navigation.
- `{#case}/{:when}` over the ten block types; `{#for}` keyed block list (island
  DOM survives keyed moves — drag reorder depends on this); built-in store
  `storage: localStorage` persistence (first example to use the PuzzleApp
  config option rather than a hand-rolled storage.js); callback props;
  computed numbered-list runs in `data()`.

## Deliberate scope cuts (demo honesty)

Inline rich text (bold/italic inside a block), multi-block selection, undo
across blocks (per-island editing breaks native undo — Notion reimplements it;
we don't), soft line breaks (Shift+Enter), and page nesting. Block nesting is
a flat list + `indent` field, like Notion's own data model.
