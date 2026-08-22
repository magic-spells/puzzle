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
├── theme/*.css               # @theme design tokens (light + dark): pieces.css default + warm/void/dim alternates
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
  never appears here. Examples: morph pieces → `@magic-spells/morph-engine`, `sheet` →
  `@magic-spells/sheet` + `@magic-spells/dialog-panel` (it wraps the web component; the
  second is its peer, which yarn 1 will not install on its own), `bottom-sheet` →
  `@magic-spells/physics-engine` (still a port), the rich-text/markdown editors →
  `@tiptap/*`, `code` → `highlight.js`, `markdown` → `marked`.

## Versioning

**puzzle-pieces tracks the Puzzle framework version.** When the framework releases 0.5.0,
this repo is 0.5.0 — there is no independent version line for the registry. Bumping means
updating every place the number is written by hand:

- `demo/package.json` `version`
- the header badge in `demo/app/layouts/Default.pzl` (`{ pieceCount } pieces · v0.5.0`)
- `demo/package.json`'s `@magic-spells/puzzle` dependency range, which should point at the
  matching framework release
- the root `package.json` `version` — the published `@magic-spells/puzzle-pieces`
  npm package the `add` CLI resolves against

The PATCH digit is the registry's own: a piece bugfix publishes as e.g. 0.6.1
(`npm publish` from the repo root) with no framework release and no demo bump.
Only major.minor moves in lockstep with the framework.

`registry/registry.json`'s `"version": 1` is the manifest SCHEMA version read by the `add`
CLI — it is unrelated and must not be bumped along with the release.

## Verification workflow

- **Compile-verify:** `cd demo && npm run build`. `@magic-spells/puzzle` is installed from
  npm (the `puzzle` bin resolves per-platform binary packages); a globally installed
  `puzzle` run directly in `demo/` works too. Every non-trivial change must compile clean
  before it's done.
- **Dev server:** `cd demo && npm run dev` on **port 3070** (3000 and several other ports
  are taken by sibling projects). Browser-smoke interactive pieces in a FOREGROUNDED tab —
  Puzzle's rAF-based view scheduler stalls re-renders in a hidden/backgrounded tab.
- **Node tests:** `npm test` at the repo root runs the DOM-free suites in `test/` against
  `registry/lib/`: `sheet-math.js` (bottom-sheet's dismissal math), the markdown and
  rich-text document models, an InputOTP suite, static wiring guards for the `sheet`
  wrapper piece, and parity suites that assert the demo copies are byte-identical to their
  `registry/` sources. These are repo-internal — nothing under `test/` or the root
  `package.json` is ever copied to a consumer. The sheet MOTION suites (engine, drag,
  snap points, scroll policy) are gone with the sheet port — that behavior now lives in
  `@magic-spells/sheet` and is tested there; `sheet-math.js` stays because `bottom-sheet`
  is still a port and still imports it. Its assertions are ported byte-identical from the
  source repo and pin exact numbers, not bounds — never loosen one to make a port fit.

## Piece conventions

- **Tailwind only, semantic tokens only.** Style with utility classes against the tokens in
  `registry/theme/pieces.css` (`bg-surface`, `text-ink`, `border-border`, `bg-brand`,
  `text-danger`, …). **No hex colors** inside components. `pieces.css` is a registry file —
  editing token VALUES there changes every consumer.
- **Wrap @magic-spells web components directly whenever possible; port only when
  wrapping genuinely can't work** (rule set 2026-08-19 as "wrap when simple", strengthened
  2026-08-22 — see `constellation/decision/DECISION-WRAP-WEB-COMPONENTS.md`; `scroll-stack`
  is the exemplar; `sheet` was the first conversion, 2026-08-22). A wrapper piece renders the
  custom element's markup around `<Slot/>`, binds props to attributes, declares the npm
  package in `piece.json.dependencies`, and upgrades it via **dynamic import in
  `mounted()`** — never a top-level import, because the package's `class extends
  HTMLElement` crashes Node prerendering. The component's stylesheet is imported at the
  app entry in `layer(components)` (e.g. `@import "@magic-spells/scroll-stack/css"
  layer(components)`) so utilities on the host still win; document it in the piece's
  installation section. A package with a peer that ships its own CSS needs BOTH imports,
  peer first (`sheet` → `@magic-spells/dialog-panel/css` then `@magic-spells/sheet/css`). Why wrap: a port is a fork — every upstream fix has to be
  re-translated by hand, and the translation is where bugs enter (the 5,600-line sheet
  port vs its 2,100-line upstream is the cautionary case). Wrapped overlays may manage
  their own open/close state and report it (`@show` / `@hide({ result })`); the parent
  re-syncs `open` after the fact. Piece-only extras go upstream first, not into a fork.
  Port only when the behavior has no web component, or when the piece's value is
  token-styled form-control markup (Calendar) where a wrapper would cost more than it
  saves. Ported pieces still follow the rule below.
- **In ported pieces: no `<style>` blocks, no `customElements.define`.** Ports compile to
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
- **Implicit two-way binding is ON (D147, puzzle ≥ 0.5.0) — pieces must stay handler-owned.**
  The compiler auto-binds a `value=`/`checked=` on a plain `<input>`/`<textarea>`/`<select>`
  when the expression is exactly `ident` or `ident.ident` AND the element has no author
  `@input`/`@change`. Component tags never bind (props are props). Nearly every piece is
  already suppressed because it carries the `@change` that routes through its callback
  prop — that is the correct pattern, not legacy, and the handler must never be deleted to
  "modernize". The trap is a piece whose inner control binds a **prop-derived** key: the
  synthesized write lands in the piece's LOCAL state and the next `data()` commit reverts
  it (dev warns `a data() commit reverted the bound key`). Note `@keydown`/`@blur` do NOT
  suppress — so an edit BUFFER committed on Enter/blur is exactly the shape that silently
  starts live-binding. Escape with a non-path expression: `value={ String(x) }` plus a
  one-line comment (see NumberField). Verify with the compiler, never by eye: compile the
  `.pzl` and grep the output for `__bind(`.
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
+ `add.go`) — there is NO npm package for the CLI itself; the default registry is the
`@magic-spells/puzzle-pieces` npm package. Contract this registry must stay compatible
with:

- Registry source chain: `--registry <path|url|npm:pkg[@version]>` flag →
  `PUZZLE_PIECES_REGISTRY` env var → the `@magic-spells/puzzle-pieces` npm package,
  resolved to the NEWEST published release whose major.minor equals the CLI's own
  version (lockstep; `--pieces-version` pins an exact release). The CLI downloads
  the npm tarball, unpacks it in memory, and reads `package/registry/…` out of it —
  the package is never installed. The old raw-GitHub default is gone as of 0.6.0.
- Reads `registry.json`, resolves `registryDependencies` transitively (dedupe), copies each
  file to its manifest `targetDir` (`app/components/ui/` for pieces, `app/lib/` for lib
  files). **Refuses to overwrite an existing target unless `--overwrite`** (all-or-nothing
  pre-flight). PRINTS — never auto-runs — npm installs for accumulated `dependencies`.
- Theme is copied like a piece: `theme/pieces.css` is written verbatim to
  `app/styles/pieces.css` when the app has neither the tokens nor the file, and the
  one-line `@import './pieces.css';` wiring step is printed (styles.css is user-owned).
  Detection keys on the `puzzle-pieces design tokens` header comment in `pieces.css` —
  **don't reword that comment without updating the CLI's marker.** `registry.json`'s
  `themes` array lists the alternates (warm, void, dim) for the docs site; the CLI reads
  only the singular `theme` key.
- Copies stay **byte-identical** to the registry (no stamped headers); `pieces.lock` at the
  consumer app root records sha256 content hashes per piece/lib so a future `diff`/`update`
  can distinguish upstream-changed from locally-customized.
