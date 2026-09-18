# CLAUDE.md — puzzle-pieces

Canonical agent guide for this package. Read this every session before touching anything.
This file is the durable contract and stands alone; deeper rationale lives in the
`constellation/` cards.

## What this repo is

A **copy-in** UI component registry for the [Puzzle framework](../puzzle)
(a compiler for `.pzl` single-file components). Pieces are Tailwind-styled, accessible,
morph-aware Puzzle components distributed as **source you copy into a consumer app**, not
packages you install.

This package lives in the `magic-spells/puzzle` monorepo at `packages/puzzle-pieces`:
release branches, feature PRs, and CI are the monorepo's, the framework root is `../puzzle`
(not a sibling checkout), and the monorepo's `release:prep` asserts this package's
version stamps at release time.

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
├── theme/*.css               # hand-written theme files: pieces.css (default palette, @theme + medium) + dim/warm/void overrides
├── theme/appearance.js       # runtime: read/persist/apply { scheme, mode } (exported as ./appearance)
├── theme/pre-paint.js        # inline anti-flash snippet for <head> (exported as ./pre-paint)
├── lib/*.js                  # shared plain-JS helpers (date-math.js, panel-stack.js, …)
└── ui/<name>/
    ├── <Name>.pzl            # one or more component files
    └── piece.json            # per-piece manifest
demo/                         # Puzzle docs-site app (port 3070) — CONSUMES copies
├── app/components/ui/*.pzl   # COPIES of registry pieces (downstream)
├── app/lib/*.js              # COPIES of registry/lib files (+ appearance.js copy, tokenNames.js name list)
├── app/styles/styles.css     # imports the four registry/theme/*.css DIRECTLY (not copies)
├── app/views/themes/*.pzl    # design-system panels: SchemePanel, Compare, Shell, Pieces
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
  "dependencies": ["@magic-spells/morph-engine@^0.1.2"],
  "targetDir": "app/components/ui"
}
```

- `files` — copied to `targetDir` (default `app/components/ui/`).
- A `files` entry **may carry a directory** — that is how a compound piece (a D167 component
  family: one-class-per-file members plus an `index.js` barrel, e.g.
  `"NavigationMenu/Item.pzl"`, sourced from `registry/ui/<name>/NavigationMenu/…`) is
  declared. The copy is **path-preserving** (`app/components/ui/NavigationMenu/Item.pzl`);
  the directory is the only signal, there is no `family` field. Entries must be clean
  relative slash paths — no `..`, no leading `./`, no backslashes, no doubled slashes.
- `registryDependencies` — other registry files pulled in transitively: `lib/*.js` files go
  to `app/lib/`; sibling pieces (e.g. DatePicker → `calendar`) go to their own targetDir.
- `dependencies` — **real npm packages, plain JS only.** `.pzl` never ships via npm, so it
  never appears here. Examples: morph pieces (Select, DatePicker) →
  `@magic-spells/morph-engine`, `sheet` → `@magic-spells/sheet` +
  `@magic-spells/dialog-panel` (it wraps the web component; the second is its peer, which
  yarn 1 will not install on its own), `bottom-sheet` → `@magic-spells/bottom-sheet` + the
  same `@magic-spells/dialog-panel` peer (also a wrapper), `dialog` and `alert-dialog` →
  `@magic-spells/dialog-panel` alone (wrappers over it directly — one dialog-panel copy
  serves all four overlays), the rich-text/markdown editors → `@tiptap/*`, `code` →
  `highlight.js`, `markdown` → `marked`.
- **Every entry carries a version FLOOR** (D169) — it is an npm install spec,
  `"<package>@<range>"`, not a bare name, and the CLI prints it verbatim
  (`npm install @magic-spells/collapsible-content@^1.2.0`). Without one npm resolves
  `latest`, which is how 0.7.0's `add piece accordion` installed collapsible-content
  1.1.1 — no `<collapsible-group>`, no exclusivity. **The floor is the version the piece
  was built and demoed against**, so it must match `demo/package.json` exactly (the caret
  form of it for the tiptap packages, which the demo pins); one floor per package across
  the whole registry, and `test/registry-deps.test.js` fails if any of that drifts. Wrap a
  component only at a **published** version — an unpublished bump cannot be a floor. When
  you bump a component in `demo/package.json`, bump the piece manifests with it. The `add`
  CLI still accepts a bare name (third-party registries) and prints it bare, but nothing
  in this registry may ship one.

## Versioning

**puzzle-pieces tracks the Puzzle framework version.** When the framework releases 0.5.0,
this package is 0.5.0 — there is no independent version line for the registry. Bumping means
updating every place the number is written by hand:

- `demo/package.json` `version`
- the header badge in `demo/app/layouts/Default.pzl` (`{ pieceCount } pieces · v0.5.0`)
- this package's `package.json` `version` — the published `@magic-spells/puzzle-pieces`
  npm package the `add` CLI resolves against

The PATCH digit is the registry's own: a piece bugfix publishes as e.g. 0.6.1
(`npm publish` from `packages/puzzle-pieces/`) with no framework release and no demo bump.
Only major.minor moves in lockstep with the framework.

The demo's `@magic-spells/puzzle` dependency is `file:../../puzzle` — the monorepo working
tree — so there is no framework range to bump at release. It is the **only** working-tree
link: every `@magic-spells/*` web component the wrapper pieces need installs from npm at
its published version (caret range), so `npm ci` in `demo/` works on any machine and the
demo build exercises the same tarballs a consumer gets.

`registry/registry.json`'s `"version": 1` is the manifest SCHEMA version read by the `add`
CLI — it is unrelated and must not be bumped along with the release.

## Verification workflow

- **Compile-verify:** `cd demo && npm run build` (runs the monorepo compiler binary
  `../../puzzle/puzzle` — build it once with `npm run build:compiler` at the repo root.
  `go run` does not work here: the demo sits outside the Go module. The demo's
  `file:../../puzzle` link covers editor/TS resolution). Every non-trivial change must
  compile clean before it's done.
- **Dev server:** `cd demo && npm run dev` on **port 3070** (3000 and several other ports
  are taken by sibling projects). Browser-smoke interactive pieces in a FOREGROUNDED tab —
  Puzzle's rAF-based view scheduler stalls re-renders in a hidden/backgrounded tab.
- **Node tests:** `npm test` at the package root runs the DOM-free suites in `test/` against
  `registry/lib/`: the markdown and rich-text document models, an InputOTP suite, static
  wiring guards for the `sheet` and `bottom-sheet` wrapper pieces, and parity suites that
  assert the demo copies are byte-identical to their `registry/` sources. These are
  repo-internal — nothing under `test/` or the root `package.json` is ever copied to a
  consumer. Every sheet MOTION suite (engine, drag, snap points, scroll policy, dismissal
  math) is gone with the two ports — that behavior now lives in `@magic-spells/sheet` and
  `@magic-spells/bottom-sheet` and is tested there.

## Piece conventions

- **Tailwind only, semantic tokens only.** Style with utility classes against the tokens in
  `registry/theme/pieces.css` (`bg-surface`, `text-ink`, `border-border`, `bg-brand`,
  `text-danger`, …). **No hex colors** inside components. `pieces.css` is a registry file —
  editing token VALUES there changes every consumer.

## Themes — four palettes × three modes (2026-09-18)

- **The CSS files are the source of truth.** `registry/theme/pieces.css` (default palette:
  `@theme` block of `light-dark(light, dark)` pairs + a medium block + a
  `[data-scheme='default']` restatement) and `dim.css` / `warm.css` / `void.css` (every
  token restated inside `[data-scheme='x']`, plus that scheme's medium block). Hand-written
  — there is NO generator, NO JS token source and NO `tokens.json` (Cory, 2026-09-18: "we
  just need a .css theme file with the css vars in it"). Edit values in the files.
- **Attributes:** `data-scheme` = palette (`dim | warm | void`; absent or `default` = the
  `@theme` values), `data-theme` = mode (`light | medium | dark`; absent = follow the OS).
  The `color-scheme` blocks and every scheme/medium block are deliberately UNANCHORED (not
  `:root`) so any element can scope a subtree: `<div data-scheme="warm" data-theme="medium">`.
- **Medium is "soft dark"** — `color-scheme: dark`, grounds lifted to mid grey, type dimmed
  a stop. A medium block lists ONLY tokens whose value differs from the dark half; the
  medium frame→panel OKLCH lightness step must be the smallest of the three modes
  (`test/contrast.test.mjs`). Selectors: `[data-scheme='x'][data-theme='medium'],
  [data-theme='medium'] [data-scheme='x']:not([data-theme])`; pieces.css additionally
  `[data-theme='medium']:not([data-scheme])`.
- **Token NAMES are frozen** — they are what Pyramid and Sites already use (`--color-ink`,
  `--color-surface-frame`, `--color-bar-*`, `--color-rail-*`, `--shadow-panel`, …). All four
  files must declare the identical set (`test/themes.test.mjs`); aliases (`--color-bar:
  var(--color-surface-frame)`, `--color-rail-ink: var(--color-bar-ink)`, …) stay aliases.
- **Marker line:** line 2 of `pieces.css` must stay ` * puzzle-pieces design tokens
  (Tailwind v4 @theme).` — the Go CLI keys installed-detection on it.
- **Exports** (`package.json`): `./themes/default.css` → `registry/theme/pieces.css`,
  `./themes/{dim,warm,void}.css`, `./appearance` (`boot/set/current/subscribe/apply/read`,
  storage key `puzzle:appearance`, JSON `{ scheme, mode }`, legacy `mixed` → `medium`),
  `./pre-paint` (inline in `<head>`, params `data-key`, `data-default-mode`,
  `data-default-scheme`). `registry.json` carries `modes` and a `themes` array
  (`{ name, file, label, description }`); the Go `Registry` struct ignores both for now.
- **Contrast:** every palette × mode must pass WCAG 2.2 AA on every declared pair in
  `test/lib/roles.mjs` (4.5 text, 3 non-text; translucent grounds flattened over
  `--color-surface`). `border`/`border-strong` are decorative and exempt; `border-dashed`
  and `ring` are held to 3:1.
- **Adding a palette:** copy `registry/theme/dim.css` → `x.css`, rename the selectors,
  retune every value, add `{ name, file, label, description }` to `registry.json.themes`,
  add it to `SCHEMES` in `appearance.js` AND `pre-paint.js` (they must agree), to
  `SCHEMES` in `test/lib/parse-theme.mjs` and `demo/app/lib/tokenNames.js`, export it in
  `package.json`, import it in `demo/app/styles/styles.css`, sync
  `demo/app/lib/appearance.js` + the inline pre-paint in `demo/app/public/index.html`
  (byte-equal, tested), run `npm test`.
- **Demo:** `demo/app/styles/styles.css` imports the four registry files directly (no
  copies to sync). `demo/app/lib/appearance.js` IS a byte-identical copy (tested) and the
  inline `<script data-key="puzzle:appearance">` in `public/index.html` must equal
  `pre-paint.js`. Colour cards read LIVE computed styles over the static name list in
  `demo/app/lib/tokenNames.js` — no JSON, and the demo never imports `test/`. The docs
  shell IS the frame/rail/panel composition (Sidebar `variant="rail"`, `bg-bar`,
  `bg-surface-panel`), with `AppearanceSwitcher` (a non-modal popover over the
  `appearance-picker` PIECE, wired to `set()`) in the rail foot. The picker piece is
  controlled — `scheme`, `mode`, `@change({ scheme, mode })` — and carries its own
  `DEFAULT_SCHEMES`/`DEFAULT_MODES` (tested equal to `appearance.js`) because copied
  pieces may not import `registry/theme/`.
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

`puzzle add piece <name…>` lives in the framework (`../puzzle/compiler/internal/pieces/`
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
- The printed line is `npm install <name>@<range> …`, one entry per package, sorted by
  package name (D169). Specs merge by NAME across the resolved set, so a package two
  pieces both need is printed once; if their floors disagree the HIGHER one is printed
  (the app must satisfy every piece it just copied). A floorless bare name loses to any
  floor and prints bare. The line is unconditional — the CLI never reads the app's
  package.json to decide whether a dependency is already satisfied; re-running the install
  with a range npm already satisfies is a no-op, and reading the manifest would trade that
  for a second source of truth. `pieces.lock` records copied bytes only; floors are the
  registry's claim, not the app's, so they are deliberately absent from it.
- A `files` entry with a directory (a compound piece) is copied **path-preserving** under
  `targetDir`, creating intermediate dirs; entries that aren't clean relative slash paths
  are rejected by name before any write, and `pieces.lock` keys nested files by their full
  app-relative path.
- Theme is copied like a piece: `theme/pieces.css` is written verbatim to
  `app/styles/pieces.css` when the app has neither the tokens nor the file, and the
  one-line `@import './pieces.css';` wiring step is printed (styles.css is user-owned).
  Detection keys on the `puzzle-pieces design tokens` header comment in `pieces.css` —
  **don't reword that comment without updating the CLI's marker.** `registry.json`'s
  `themes` array (`{ name, file, label, description }`) and `modes` list the palettes for
  the docs site and a future `puzzle add theme <name>`; the CLI reads only the singular
  `theme` key today (Go's `json.Unmarshal` ignores the unknown keys).
- Copies stay **byte-identical** to the registry (no stamped headers); `pieces.lock` at the
  consumer app root records sha256 content hashes per piece/lib so a future `diff`/`update`
  can distinguish upstream-changed from locally-customized.
