# CLAUDE.md — puzzle-pieces

Canonical agent guide for this repo. Read this every session before touching anything.
This file is the durable contract and stands alone; deeper rationale lives in the
`constellation/` cards.

## What this repo is

A **copy-in** UI component registry for the [Puzzle framework](../puzzle)
(a compiler for `.pzl` single-file components). Pieces are Tailwind-styled, accessible,
morph-aware Puzzle components distributed as **source you copy into a consumer app**, not
packages you install.

**Why pieces can't ship as npm imports:** plain-JS npm packages work fine in a Puzzle app,
but `.pzl` files inside `node_modules` are unsupported — the compiler's formatter scan prunes
`node_modules` (out of scope for v1 per the compiler source), and the app's Tailwind
`@source` scan only covers `app/`, so a package-shipped piece would render unstyled. So
pieces must land in the app's own `app/components/ui/`, where the consumer's `puzzle build`
compiles them and their Tailwind scan picks up the classes. This is the whole reason the
repo is shaped as a copyable registry.

## Topology — registry is source of truth, demo is downstream

```
registry/                     # SOURCE OF TRUTH
├── registry.json             # aggregated index of every piece manifest
├── theme/pieces.css          # @theme design tokens (light + dark)
├── lib/*.js                  # shared plain-JS helpers (date-math.js, panel-stack.js, …)
└── ui/<name>/
    ├── <Name>.pzl            # one or more component files
    └── piece.json            # per-piece manifest
demo/                         # Puzzle docs-site app (port 3070) — CONSUMES copies
├── app/components/ui/*.pzl   # COPIES of registry pieces (downstream)
├── app/lib/*.js              # COPIES of registry/lib files
├── app/views/components/*Doc.pzl  # one docs page per piece
├── app/docs/nav.js           # sidebar / index / prev-next config (single source list)
└── app/routes.js             # route table (kebab piece names, alphabetical)
```

Rules that follow from this:
- **Edit a piece in `registry/` first, then sync the copy in `demo/app/components/ui/`**
  (and `demo/app/lib/` for lib files). The demo copies are strictly downstream; never let
  them drift from the registry source.
- **`registry.json` is generated** by aggregating the `piece.json` manifests. When you add
  or rename a piece, add its manifest and regenerate/extend the index (keep pieces
  alphabetical; represent lib files the way `date-math.js` / `panel-stack.js` are).
- A new piece's demo surface is: the copied file(s), a `*Doc.pzl` page under
  `app/views/components/`, a `nav.js` entry, and a `routes.js` entry. Untracked new files do
  NOT ride along in another session's refactor commits — re-check any new Doc page against
  the current exemplar before shipping.

## piece.json manifest shape

```json
{
  "name": "date-picker",
  "description": "One-line description (reused as the docs subtitle).",
  "files": ["DatePicker.pzl"],
  "registryDependencies": ["calendar", "lib/date-math.js"],
  "dependencies": ["@magic-spells/morph-engine"],
  "targetDir": "app/components/ui"
}
```

- `files` — copied to `targetDir` (default `app/components/ui/`).
- `registryDependencies` — other registry files pulled in transitively: `lib/*.js` files go
  to `app/lib/`; sibling pieces (e.g. DatePicker → `calendar`) go to their own targetDir.
- `dependencies` — **real npm packages, plain JS only.** `.pzl` never ships via npm, so it
  never appears here. Morph pieces list `@magic-spells/morph-engine` (npm-safe plain JS).

## Verification workflow

- **Compile-verify:** `cd demo && npm run build`. `@magic-spells/puzzle` is installed from
  npm (the `puzzle` bin resolves per-platform binary packages); a globally installed
  `puzzle` run directly in `demo/` works too. Every non-trivial change must compile clean
  before it's done.
- **Dev server:** `cd demo && npm run dev` on **port 3070** (3000 and several other ports
  are taken by sibling projects). Browser-smoke interactive pieces in a FOREGROUNDED tab —
  Puzzle's rAF-based view scheduler stalls re-renders in a hidden/backgrounded tab.

## Piece conventions

- **Tailwind only, semantic tokens only.** Style with utility classes against the tokens in
  `registry/theme/pieces.css` (`bg-surface`, `text-ink`, `border-border`, `bg-brand`,
  `text-danger`, …). **No hex colors** inside components. `pieces.css` is a registry file —
  editing token VALUES there changes every consumer.
- **No `<style>` blocks. No custom elements / `customElements.define`.** Pieces compile to
  plain semantic HTML with ARIA and Tailwind classes. **The one sanctioned exception is
  `code`** — highlight.js generates its `.hljs-*` class names at RUNTIME and injects them
  with `innerHTML`, so they can never be Tailwind utilities and Tailwind's scan can never
  see them. That block is deliberately unscoped (a `scoped` block wraps the CSS in
  `@scope ([data-<hash>])` keyed to a stamp on the template root — the injected spans are
  inside that root, so scoping would in fact still match, but global keeps the piece
  independent of the stamp). Reach for `<style>` ONLY when class names are machine-
  generated; anything you can express as a utility must stay a utility.
  Note `@apply` does NOT work inside `<style>` — Tailwind never processes that text, so
  the rule survives literally into the bundle and the browser silently drops it. Raw
  properties and `var(--…)` are fine.
- **One exported `PuzzleView` per file**, PascalCase filename, single root element.
- **Config-first APIs, not compound components** — Puzzle has no cross-component context.
  `<Select options={…} value={…} @change={…}/>`, not `<SelectTrigger>`+`<SelectContent>`.
  Presentational structure = named slots or documented Tailwind markup, never coordinating
  subcomponents.
- **Controlled-component discipline everywhere.** The parent owns `value`/`open` state;
  props in, callbacks out. Callbacks are **value-first** (`this.props.change(value)`).
  Standard vocabulary: `variant`, `size`, `disabled`, `value`, `label`, `placeholder`,
  `class` (merged onto root); callbacks `@change`, `@press`, `@show`, `@hide`, `@ready`.
- **Native `<dialog>` overlays** preventDefault the `cancel` event and let the parent flip
  `open` — they never self-close. Never put a bare display utility (`flex`) on a `<dialog>`;
  it defeats `dialog:not([open]){display:none}` — use the `open:` variant (`open:flex`).
- **`{#for}` bodies need a single element root** — precompute per-row role/class in `data()`,
  or wrap in a `display:contents` element.
- `inert={ !open }` compiles fine; `aria-hidden` needs the **string** form.
- **Focus flash:** Tailwind's `transition-colors` animates `outline-color`, so an outline
  color set only under `focus-visible:` flashes from the default on every focus. Set the
  outline COLOR unconditionally (`outline-ring` / `outline-danger`) alongside the
  `focus-visible:outline-2` reveal.
- **Morph:** overlay pieces expose an opt-in `morph` prop. Morphable roots must not use
  transform positioning, stylesheet `opacity`, a changing dynamic `style={}` binding, or
  `animations.in/out`. Trigger↔panel morph imports `@magic-spells/morph-engine` (declare it
  in `dependencies`). `prefers-reduced-motion` is respected.
- Per-piece specifics live in each `piece.json` description and the file's header comment —
  don't duplicate them here.

## Hard-won gotchas

- **Tailwind v4 `translate-x-*` / `scale-*` set the CSS `translate`/`scale` PROPERTIES, not
  `transform`.** A `transition-[transform,…]` list will never animate them — panels/elements
  snap instead of sliding. Name `translate` and `scale` **explicitly** in any transition that
  moves an element.
- **Literal angle-bracket tag names and literal `{#if}` / `{#for}` tokens break template
  PROSE** (the compiler tries to parse them). They are fine inside JS template-literal
  strings — which is exactly why docs code samples live as template-literal consts in a
  view's `<script>`.
- **ExampleBox / demo frames must NOT be `overflow-hidden`** — it clips opened popovers,
  tooltips, and dropdowns. Let the code area clip itself instead.
- **Slot targeting is direct-children-only and compile-time.** A `slot="name"` element
  must sit immediately inside the component tag; an `{#if}`/`{#for}` block at that level
  can't be routed to a slot (compile error: "ambiguous"). Make the condition internal —
  either a direct-child wrapper that carries the `slot` attribute with the control flow
  inside it, or branch the entire component call.
- **Composition markers are capitalized (D134, puzzle 0.4.0).** `<Children/>` receives
  untagged call-site content, `<Slot/>` is the router outlet, and `<Slot name="x"/>` is a
  named slot. The `slot="x"` call-site attribute is unchanged. Lowercase
  `<slot>`/`<children>` are compile errors in every form.
- **Stock chrome goes in a marker's FALLBACK BODY (D141).** A paired marker's body is
  fallback content: it renders only when nothing fills that position, and call-site
  content replaces it entirely. That is how a piece expresses default chrome —
  `<Slot name="trigger">…stock chrome…</Slot>` — and it is the shape the six trigger
  pieces (HoverCard, Popover, Popconfirm, DropdownMenu, EmojiPicker, EmojiPickerSimple)
  use. A fallback body is ordinary template content (interpolations, `{#if}`/`{#for}`,
  components, `{#svg}`); the one restriction is that a marker may not appear inside
  another marker's fallback body. Self-closing means no fallback.
  Consequences for piece APIs: **a filled slot WINS over the label prop** (the label
  powers the fallback text only), so a custom trigger must carry its own accessible
  name; and filling the slot is itself the opt-in, so no `customTrigger`-style gating
  boolean is needed. There is still no is-slot-filled probe. Document the fallback
  contract in the piece's header comment.
- **A component's `@event` name must not equal one of its prop names.** `@sort={…}` on a
  component tag compiles to a bare `sort` key in the same props object as a `sort={…}`
  value prop — a duplicate key where the last one silently wins, breaking controlled
  mode and optional-controlled detection. Name callbacks differently from their value
  props (the `open` + `@show`/`@hide` convention; DataTable uses `sort` + `@sortChange`).
- **SVG `<text>` elements are silently dropped by the compiler.** Codegen emits
  `ViewNode('text', …)` as its internal text-node marker, so an SVG `<text>` element
  collides with it and never reaches the DOM (no error — it just vanishes). Render chart
  axis labels / in-SVG text as absolutely-positioned HTML spans overlaying the SVG
  instead; the chart pieces use explicit pixel coordinates (no viewBox scaling) so the
  positions map 1:1. See LineChart/BarChart/AreaChart for the pattern.
- **The compiler does not decode HTML entities in template prose.** `&amp;`, `&rsquo;`,
  `&nbsp;`, `&lt;`… reach `createTextNode` verbatim and render as the literal source text.
  Write the real character instead (`&`, `’`, `—`, `→`). For angle brackets — which
  literal-form would be parsed as a tag — put the text in an interpolation:
  `<code>{ '<figure>' }</code>`.

## The `add` CLI (shipped in the Puzzle Go CLI)

`puzzle add piece <name…>` lives in the puzzle repo (`../puzzle/compiler/internal/pieces/`
+ `add.go`) — there is NO npm package; making this repo public activates the default
registry URL. Contract this registry must stay compatible with:

- Registry source chain: `--registry <path|url>` flag → `PUZZLE_PIECES_REGISTRY` env var
  → `https://raw.githubusercontent.com/magic-spells/puzzle-pieces/main/registry`.
- Reads `registry.json`, resolves `registryDependencies` transitively (dedupe), copies each
  file to its manifest `targetDir` (`app/components/ui/` for pieces, `app/lib/` for lib
  files). **Refuses to overwrite an existing target unless `--overwrite`** (all-or-nothing
  pre-flight). PRINTS — never auto-runs — npm installs for accumulated `dependencies`.
- Theme is copied like a piece: `theme/pieces.css` is written verbatim to
  `app/styles/pieces.css` when the app has neither the tokens nor the file, and the
  one-line `@import './pieces.css';` wiring step is printed (styles.css is user-owned).
  Detection keys on the `puzzle-pieces design tokens` header comment in `pieces.css` —
  **don't reword that comment without updating the CLI's marker.**
- Copies stay **byte-identical** to the registry (no stamped headers); `pieces.lock` at the
  consumer app root records sha256 content hashes per piece/lib so a future `diff`/`update`
  can distinguish upstream-changed from locally-customized.
