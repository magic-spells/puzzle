---
name: The registry — source of truth
kind: guide
status: built
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
      0.8.0, feat/piece-image-zoom: new `image-zoom` piece — a WRAPPER over @magic-spells/image-zoom
      (floor ^0.1.0, the only published release), see COMPONENT-IMAGE-ZOOM. Registry manifest +
      registry.json row, demo copy, ImageZoomDoc page, nav/routes entries, `@import
      "@magic-spells/image-zoom/css" layer(components)` in demo/app/styles/styles.css, and
      test/image-zoom-wrapper.test.js (wired into all.test.js). The image is a PROP, not a slot —
      the component caches its single `<img>` child at connect and writes the transform into its
      inline style, so the piece owns that element; a `src` change re-attaches the host so the
      component re-measures.
  - kind: state
    text: >-
      0.8.0 (feat/piece-split-text): new piece `split-text` — a wrapper over
      @magic-spells/split-text, floor ^0.2.0, one file (SplitText.pzl), no registry deps. Adds the
      `@magic-spells/split-text/css` import to demo/app/styles/styles.css and a docs page at
      /components/split-text. See COMPONENT-SPLIT-TEXT: replay is a `play` TOKEN prop
      (edge-triggered in afterUpdate → element.split(), plus reveal() for trigger="manual"), which
      is also the only way a changed attribute is applied since the element observes none; the host
      binds no `style` (the element writes the timing custom properties there itself).
---

# The registry — source of truth

`registry/` is the canonical home of every piece; everything else (the demo, the future CLI, external apps) is downstream. Its shape is deliberately conventional for a copy-in registry ([[DECISION-REGISTRY-SHAPED-REPO]]) so distribution is pure copying ([[DECISION-COPY-IN-DISTRIBUTION]]).

```
registry/
├── registry.json          # generated index aggregating every piece manifest
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
- `dependencies` are **real npm packages, plain JS only** — `.pzl` never appears there. Morph pieces (Select, Dialog, DatePicker) list `@magic-spells/morph-engine`.
- Each `dependencies` entry is an npm INSTALL SPEC carrying a semver **floor**, not a bare package name: `"@magic-spells/collapsible-content@^1.2.0"`. The floor is the version the piece was built and demoed against, so it must equal what `demo/package.json` installs; one floor per package registry-wide. `puzzle add piece` prints the spec verbatim, which is what stops a wrapper from resolving against an npm `latest` older than the element it wraps (D169 in the framework plan — 0.7.0's `add piece accordion` installed collapsible-content 1.1.1 and lost `<collapsible-group>`). The CLI still accepts a bare name so third-party registries keep working; nothing here may ship one, and `test/registry-deps.test.js` enforces both that and the demo agreement.
- `description` is reused verbatim as the docs subtitle, so it must read as one clean sentence.

## registry.json is generated



`registry.json` is not hand-maintained per entry — it is the aggregation of all `piece.json` manifests, pieces alphabetical, with a top-level `theme` pointer and `version`. **Regenerate it whenever a piece is added or renamed** (re-run the aggregation; lib files are represented via their consumers' `registryDependencies`, e.g. `lib/date-math.js`). Current count: **100 pieces** — keep the README and the demo shell (`Introduction.pzl`, `ComponentsIndex.pzl`) count in sync when it changes.

## theme/pieces.css is the token source


Every piece styles itself exclusively through the semantic utilities the `@theme` tokens generate (`bg-surface`, `text-ink`, `border-border`, `bg-brand`, `text-danger`, shell roles `bg-bar` / `bg-rail` / `bg-surface-panel`, …) — no hex inside components. Since 2026-09-18 ([[DECISION-THEMES-IN-PIECES]], [[FEATURE-THEMES]]) `registry/theme/` holds **four hand-written palette files and the runtime**:

- `pieces.css` — the default palette: `:root { color-scheme: light dark }` + `[data-theme]` color-scheme blocks, the Tailwind v4 `@theme` block where every token is a `light-dark(light, dark)` pair, a `[data-theme='medium']` block (only the tokens that differ from dark), and a `[data-scheme='default']` restatement. Line 2 is the CLI's installed-detection marker — do not reword it.
- `dim.css`, `warm.css`, `void.css` — every token restated inside `[data-scheme='x']`, plus that scheme's medium block. Inert until `data-scheme` selects them.
- `appearance.js` (export `./appearance`) and `pre-paint.js` (export `./pre-paint`); `registry.json` lists `themes` (`{ name, file, label, description }`) and `modes`.

Two attributes drive it: `data-scheme` = palette, `data-theme` = mode (`light | medium | dark`). Selectors are unanchored so any element can scope a subtree. The files ARE the source of truth (no generator, no JSON); `test/themes.test.mjs` holds the four to one identical token set and `test/contrast.test.mjs` holds every palette × mode to WCAG 2.2 AA over the pairs in `test/lib/roles.mjs`. Token NAMES are what Pyramid and Sites already use and are frozen. Consumers import the package exports (or copy the files) after `@import "tailwindcss"`.

## lib/ convention

`registry/lib/` holds shared plain-JS helpers copied to the consumer's `app/lib/`; examples include date math for Calendar/DatePicker, panel-state helpers, document models, chart/slider math, and Code's highlight adapter. They are pulled in only via a piece's `registryDependencies` — no piece imports another piece's `.pzl`, only its lib.

Per-piece specifics stay in each manifest and file header by default; broad catalog cards would drift. A behavior-bearing composition contract may earn a focused COMPONENT card when its cross-file ownership or constraints are not obvious from one source file. [[COMPONENT-TREE]] and [[COMPONENT-KANBAN]] are the current examples. See [[DECISION-WRAP-WEB-COMPONENTS]] and [[DECISION-CONFIG-FIRST-API]] for the conventions all pieces share.
