---
name: The registry — source of truth
kind: guide
status: verified
connections:
  - PLAN-PROJECT
  - DIAGRAM-TOPOLOGY
  - DECISION-COPY-IN-DISTRIBUTION
  - DECISION-REGISTRY-SHAPED-REPO
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
notes:
  - kind: state
    text: >-
      Pieces follow the seed/derive/set state pattern (CLAUDE.md "Piece conventions"): setState()
      re-runs data() when data() read the written key (framework D23), so render-feeding values are
      state keys, not instance fields. The refresh() calls that remain are deliberate and commented:
      Toaster's module-store subscription, Code's FLIP height measure, the charts' ResizeObserver
      width measure (LineChart, AreaChart, BarChart), opening a row that takes focus at once
      (MarkdownEditor/RichTextEditor link row and block menu), the open-edge seeds in Command /
      Combobox / MultiSelect / TimePicker, placement and morph-top corrections in the pickers,
      Sidebar's flyout clamp, and Kanban's keyboard move announcement.
  - kind: state
    text: >-
      date-picker, emoji-picker and emoji-picker-simple pin `@magic-spells/morph-engine@^0.4.2`.
      0.4.1 normalizes captured colours to `rgba()`; without it a Tailwind v4 opacity-modified
      border (`border-border/60`, serialized as `oklab(…)`) paints a white hairline on dark themes
      for the whole flight. 0.4.2's `container` option is unused because no piece morphs into a
      `showModal()` dialog; revisit it if one does.
  - kind: gotcha
    text: >-
      Every item-form `{#for}` row needs a key. With no `key={ … }` on the row root the runtime keys
      by `.id` (ViewNode.keyOf); a row without one drops the list to positional diffing and the
      CONSUMER's console logs `[puzzle] {#for} item (Object) has no usable key` once per session.
      Nine pieces needed explicit keys: sidebar, radio-group, breadcrumb, dropzone, stepper,
      timeline, time-picker (columns), chat-attachment and spinner. Convention: precompute a `key`
      in data() and bind `key={ row.key }`; key by a real identity (option value, column, path
      string) and fall back to the position only when items carry no id (Sidebar keeps its existing
      `index`, which already owns the open map and ids). breadcrumb, stepper and timeline key by the
      caller's `id` when it gives one and by `'#' + index` otherwise, so a partial set of numeric
      ids cannot collide with a position. Loops whose rows carry an `id` may stay implicit — but
      pie-chart's full-circle slice draws two paths from one slice, so marks bind their own per-path
      `m.key` (bar-chart binds `m.key` the same way). `test/for-keys.test.js` strips HTML comments,
      then fails on any keyless loop not listed in its per-file ID_KEYED allow-list (with a count
      for each loop name), and on stale allow-list entries.
  - kind: state
    text: >-
      Pieces with no card of their own: RichTextEditor keeps an external value reset off the undo
      stack (`setMeta('addToHistory', false)`), renders links with no `target` (Tiptap's Link
      defaults to `_blank`), supports left/center/right alignment only (a pasted justify parses to
      left), and drives both the placeholder and the blocks "/" hint from one `blankDoc` predicate
      so the two never overlap. AspectRatio uses CSS `aspect-ratio`, so a max-w cap or a grid track
      keeps the ratio. MultiSelect keeps focus in its input on mousedown (`keepFocus`), so a pick
      does not blur it. PasswordField is controlled only: every render re-applies `value`, so pair
      it with `@change`.
  - kind: state
    text: >-
      Sidebar marks the active submenu child only with the row's `v.active` tint and weight, never a
      coloured left stripe; the submenu guide is a neutral `border-l` in `v.line`. ProgressRing and
      Rating set their default colour as `[:where(&)]:text-brand` (Sparkline
      `[:where(&)]:text-chart-1`), which has zero specificity, so any text colour in `class` wins.
      Tabs uses the same `[:where(&)]` idiom.
    sha: 0c470749
  - kind: state
    text: >-
      Carousel's live region is `off` only while autoplay is actually running (`autoplay` > 0, not
      `paused`, reduced motion off). When hover or focus pauses it, or reduced motion disables it,
      the region is `polite`, so a keyboard user's Next still announces. Pause state is the `paused`
      data key, written through `_pause()`. With one slide the carousel renders no dots and no
      arrows.
    sha: a52e0c59
  - kind: state
    text: >-
      Toast: the store has one `paused` flag (pauseAll/resumeAll), so a toast that arrives while the
      stack is hovered starts paused. Pausing on keyboard focus is deliberately not built: with one
      flag, a focused toast dismissed by Enter fires no focusout and would leave every later toast
      paused. Stepper is controlled only. Badge's outline variant uses `ring-1 ring-inset` (no
      layout box), so every variant is 20px tall. NumberField's step buttons round to `precision ??
      12`, which removes 0.1 + 0.2 noise. The EmojiPicker and EmojiPickerSimple morph panels are
      centred on the trigger (`left-1/2 -ml-36`) with no horizontal clamp.
  - kind: state
    text: >-
      Each registry check has one owner. test/registry-parity.test.js byte-compares every demo copy.
      test/registry-deps.test.js holds every registry.json row to its piece.json with one deepEqual
      and keeps the rows alphabetical. A piece's own suite carries no inline byte-compare,
      registry.json mirror or "exists on disk" check; add those to the owner instead. A new suite
      needs no wiring: `npm test` runs every test/*.test.js and test/*.test.mjs file once.
    sha: f90f22201ff6b00245f353d5f5f90bb7634bb963
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# The registry — source of truth

`registry/` is the canonical home of every piece; everything else (the demo, the `puzzle add` CLI, external apps) is downstream. Its shape is deliberately conventional for a copy-in registry ([[DECISION-REGISTRY-SHAPED-REPO]]) so distribution is pure copying ([[DECISION-COPY-IN-DISTRIBUTION]]).

```
registry/
├── registry.json          # index aggregating every piece manifest (kept by hand)
├── theme/pieces.css       # @theme design tokens (light + dark)
├── lib/*.js               # shared plain-JS helpers (copyable registryDependencies)
└── ui/<name>/
    ├── <Name>.pzl         # one or more component files
    └── piece.json         # per-piece manifest
```

## piece.json semantics

The manifest schema and per-field meaning live in CLAUDE.md; the load-bearing rules:
- `files` copy to `targetDir` (default `app/components/ui/`).
- `registryDependencies` are resolved **transitively**: `lib/*.js` → `app/lib/`, sibling pieces (e.g. `date-picker` → `calendar`) → their own `targetDir`.
- `dependencies` are **real npm packages, plain JS only** — `.pzl` never appears there. The morph pieces (DatePicker, EmojiPicker, EmojiPickerSimple) list `@magic-spells/morph-engine`.
- Each `dependencies` entry is an npm INSTALL SPEC carrying a semver **floor**, not a bare package name: `"@magic-spells/collapsible-content@^1.2.0"`. The floor is the version the piece was built and demoed against, so it must equal what `demo/package.json` installs; one floor per package registry-wide. `puzzle add piece` prints the spec verbatim, which is what stops a wrapper from resolving against an npm `latest` older than the element it wraps (D169 in the framework plan). The CLI still accepts a bare name so third-party registries keep working; nothing here may ship one, and `test/registry-deps.test.js` enforces both that and the demo agreement.
- `styles` lists the stylesheets a wrapper REQUIRES, in load order (`"@magic-spells/dialog-panel/css"`). `puzzle add piece` prints one `@import "<spec>" layer(components);` line per entry and never edits `styles.css`. dialog-panel is a peer of Sheet and BottomSheet, so they list its sheet before their own. Only the piece that installs a package lists its sheet: the dropdown family (DropdownMenu, Popover, HoverCard, …) gets dropdown-panel's through `registryDependencies`. An optional sheet such as a package's `/css/effects` is not listed; the piece's file header names it. `test/registry-deps.test.js` checks that each style's package is in the same manifest's `dependencies`, that the demo imports it the same way, and that a piece installing a package whose sheet the demo imports lists that sheet.
- `description` is reused verbatim as the docs subtitle, so it must read as one clean sentence.

## registry.json is kept by hand

`registry.json` is the aggregation of the `piece.json` manifests, kept by hand (there is no generator): mirror every manifest edit in its row, pieces alphabetical, with the top-level `version`, `theme`, `modes` and `themes`. `registry.json mirrors every manifest, including the floors` in `test/registry-deps.test.js` fails when a row drifts from its manifest. Lib files are represented via their consumers' `registryDependencies`, e.g. `lib/date-math.js`. Current count: **104 pieces** — keep the README count in sync when it changes (the demo shell's `Introduction.pzl`, `ComponentsIndex.pzl` and header badge compute `pieceCount`, so they follow on their own).

## theme/pieces.css is the token source


Every piece styles itself exclusively through the semantic utilities the `@theme` tokens generate (`bg-surface`, `text-ink`, `border-border`, `bg-brand`, `text-danger`, shell roles `bg-bar` / `bg-rail` / `bg-surface-panel`, …) — no hex inside components. Themes live in pieces ([[DECISION-THEMES-IN-PIECES]], [[FEATURE-THEMES]]) as four schemes × four styles ([[DECISION-SCHEMES-AND-STYLES]], [[FEATURE-APPEARANCE-STYLES]]), so `registry/theme/` holds **four hand-written palette files and the runtime**:

- `pieces.css` — the default palette: `:root { color-scheme: light dark }` + `[data-theme]` color-scheme blocks (light and mixed → light, dark and dim → dark), the Tailwind v4 `@theme` block where every token is a `light-dark(light, dark)` pair, a `[data-theme='dim']` block (only the tokens that differ from dark), a `[data-theme='mixed']` block (exactly the frame roles, at their dark values), and a `[data-scheme='default']` restatement. Line 2 is the CLI's installed-detection marker — do not reword it.
- `cool.css`, `warm.css`, `void.css` — every token restated inside `[data-scheme='x']`, plus that scheme's dim and mixed blocks. Inert until `data-scheme` selects them. The runtime reads a stored `dim` scheme as `cool`.
- `appearance.js` (export `./appearance`) and `pre-paint.js` (export `./pre-paint`); `registry.json` lists `themes` (`{ name, file, label, description }`) and `modes` (the styles).

Two attributes drive it: `data-scheme` = palette, `data-theme` = style (`dark | dim | mixed | light`; the runtime field is called `mode`). Selectors are unanchored so any element can scope a subtree. The files ARE the source of truth (no generator, no JSON); `test/themes.test.mjs` holds the four to one identical token set and the dim/mixed block shapes, and `test/contrast.test.mjs` holds every palette × style to WCAG 2.2 AA over the pairs in `test/lib/roles.mjs`. Token NAMES are what Pyramid and Sites already use and are frozen. Consumers import the package exports (or copy the files) after `@import "tailwindcss"`.

## lib/ convention

`registry/lib/` holds shared plain-JS helpers copied to the consumer's `app/lib/`; examples include date math for Calendar/DatePicker, document models, chart/slider math, and Code's highlight adapter. They are pulled in only via a piece's `registryDependencies`. A piece built on another piece lists it there too and imports the copied sibling file (DataTable imports `./Pagination.pzl`, AvatarGroup imports `./Avatar.pzl`).

Per-piece specifics stay in each manifest and file header by default; broad catalog cards would drift. A behavior-bearing composition contract may earn a focused COMPONENT card when its cross-file ownership or constraints are not obvious from one source file. [[COMPONENT-TREE]] and [[COMPONENT-KANBAN]] are the current examples. See [[DECISION-WRAP-WEB-COMPONENTS]] and [[DECISION-CONFIG-FIRST-API]] for the conventions all pieces share.
