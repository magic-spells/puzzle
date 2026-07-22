# Grimoire

A Notion clone for the [Puzzle](../../README.md) framework — a spellbook of
living pages. A fixed sidebar of pages, routed documents, and a block editor
where **every text surface is always editable**: click anywhere, type, hit
Enter, drag blocks around. Everything persists to `localStorage`.

Grimoire is the motivating app for **v1.13's DOM islands** (SPEC §17, D44) and
copies Notion's real architecture: many small per-block *uncontrolled*
`contenteditable` elements over a JS document model — not one big editable
surface, and not a framework-managed text binding.

## Run it

```bash
puzzle dev examples/grimoire      # dev server + live reload
puzzle build examples/grimoire    # production build to dist/
```

## What it does

- **Always-on editing** — every block and the doc title is a
  `contenteditable="true" island`. Input flows island → store per keystroke
  (watch the sidebar retitle live as you edit a page title); the store never
  writes back into a mounted island, so the caret survives every repaint.
- **Notion keyboard model** — Enter splits the block at the caret (lists and
  todos continue their type; Enter on an empty list item turns it back into a
  paragraph); Backspace at the start merges into the block above; ArrowUp/Down
  at a boundary walk between blocks; paste is forced to plain text; Tab and
  Shift-Tab indent and outdent (0–3).
- **`/` commands** — type `/` in an empty block (or after a space) and a
  filterable command menu converts the block: Text, Heading 1–3, Bulleted,
  Numbered, To-do, Quote, Code, Divider. Arrows + Enter or click; Escape leaves
  the text as typed.
- **⠿ block handle** — hover a block for its gutter handle. *Click* opens
  Turn-into (convert type or delete); *drag* reorders with a ghost, a tracking
  placeholder, and FLIP animations (Escape cancels). Blocks are keyed, so the
  patcher *moves* the live DOM — text you typed but haven't blurred survives
  the drop.
- **Ten block types** — paragraph, heading1–3, bullet, numbered (run-aware
  numbering that respects indent), todo, quote, code, divider — dispatched via
  `{#case}`/`{:when}`.
- **Store persistence** — the whole grimoire survives reload via the built-in
  `storage: window.localStorage` config.

## Deliberate scope cuts

Inline rich text (bold/italic *within* a block), multi-block selection,
cross-block undo (per-block editables break native undo; Notion reimplements
its own stack), soft line breaks (Shift+Enter), and nested pages. Block
nesting is a flat list plus an `indent` field — which is close to Notion's own
data model anyway.

## How the editor works (the short version)

1. **Islands (v1.13, D44).** The template *seeds* each block's text once; after
   that the browser owns the subtree and the virtual DOM never reconciles it.
   The element's own attributes and listeners keep patching normally.
2. **One-way flow.** `@input` pushes `textContent` to the store. Programmatic
   text changes (a merge, a split, stripping a `/query`) must update the island
   DOM *imperatively* and the store together — the framework deliberately won't
   re-sync store → island.
3. **Keyed `{#case}` branches.** Every block-type branch root has a distinct
   static `key`, so converting a block's type replaces the node and re-seeds a
   fresh island (the D44 "change the key to reset" lever). Without the keys,
   the old frozen children would be carried across the type change.
4. **Focus routing (`lib/focus.js`).** Component mounts are async, so a caret
   can't be placed synchronously into a block that doesn't exist yet. One
   pending request; the target block consumes it in its own
   `mounted()`/`afterUpdate()`, with a rAF-retry sweep in Doc as the backstop.
   When the focus target is the block being *converted* (same id, re-seeding),
   only park the request — a synchronous sweep would grab the stale island.
5. **Doc owns store/order math; Block owns caret math** (`lib/caret.js`).
   Callback props connect them: `@sync/@split/@mergeUp/@navigate/@convert/`
   `@remove/@toggle/@slash/@slashKey/@grab/@indentBy`. Blocks receive only
   primitive props.

## Models

- **page** — `id`, `title`, `icon` (emoji), `order`, timestamps.
- **block** — `id`, `pageId`, `type` (one of ten), `text`, `checked`, `indent`
  (0–3), `order`, timestamps.

## Structure

```
app/
├── app.js                # PuzzleApp + boot-time seeding
├── routes.js             # / , /p/:id , * (catch-all → Home)
├── models/               # page, block, registry
├── layouts/Default.pzl   # sidebar shell + <Slot/>
├── views/
│   ├── Home.pzl          # redirect-to-first / empty state
│   └── Doc.pzl           # doc + menus + drag machine + store/order math
├── components/Block.pzl  # one block: keyed {#case type}, island wiring
└── lib/
    ├── caret.js          # plain-text Selection/Range utilities
    └── focus.js          # cross-block caret routing (park + consume + sweep)
```
