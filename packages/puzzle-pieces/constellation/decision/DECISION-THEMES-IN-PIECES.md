---
name: Themes live in pieces as hand-written CSS, four palettes × three modes
status: built
connections:
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
  - FEATURE-THEMES
  - DECISION-COPY-IN-DISTRIBUTION
---


# Themes live in pieces as hand-written CSS, four palettes × three modes

## Context

Pyramid, Sites web/admin, the account apps and magicspells.io each carried their own copy of the puzzle-pieces palettes and each re-tuned them (Sites re-cut `muted` for AA; Pyramid added shell roles — `surface-frame`, `bar-*`, `rail-*`, `surface-panel` — and a third `mixed` mode; Sites' `dim.css` kept three stale blue rail values). One source of colour was needed, and the token NAMES had to stay exactly what those apps already use.

## Decision

- **Themes live INSIDE `@magic-spells/puzzle-pieces`**, in `registry/theme/`, not in a separate package. Cory (2026-09-18): "we integrate the themes into puzzle-pieces repo directly and have the different themes as css files."
- **The CSS files are the source of truth — hand-written, no generator.** Cory (2026-09-18): "we just need a .css theme file with the css vars in it." `pieces.css` (default palette: the Tailwind v4 `@theme` block of `light-dark(light, dark)` pairs, a medium block, a `[data-scheme='default']` restatement) plus `dim.css`, `warm.css`, `void.css` (every token restated inside `[data-scheme='x']` plus that scheme's medium block). Tests parse the CSS to hold the four files to one identical token set and to WCAG 2.2 AA on every declared pair (`test/themes.test.mjs`, `test/contrast.test.mjs`, shared parser `test/lib/parse-theme.mjs`, roles in `test/lib/roles.mjs`).
- **Three modes, `medium` = "soft dark"**: `color-scheme: dark`, grounds lifted to mid grey, type dimmed a stop, and the frame→panel OKLCH lightness step kept the smallest of the three modes so the panel still reads as set down on the frame. A medium block lists only the tokens that differ from the dark half.
- **Two attributes**: `data-scheme` = palette (absent for default), `data-theme` = mode (`light | medium | dark`; absent = follow OS). All scheme/mode selectors are unanchored (not `:root`) so any element can scope a subtree — the appearance picker's preview cards and the docs compare grid depend on it.
- **Palette identities** (Cory's words): Default "navy-tinted, classy, premium" near-black with indigo; Void black, Vercel-like, high contrast; Warm the Claude/Anthropic tan/brown/orange with clay `#CC785C`; Dim blue-grey (hue ≈220) at about half the chroma, lower contrast than Default/Void — every palette × mode must still pass AA.
- Runtime in the same folder: `appearance.js` (exported as `./appearance`) and `pre-paint.js` (`./pre-paint`); `registry.json` lists `themes` and `modes`.

## Alternatives

- **A separate `@magic-spells/puzzle-themes` package** — rejected: one more package to version and install for something every pieces consumer needs; the pieces registry already ships `pieces.css`.
- **JS token data (`src/themes/*.js`) + a generator emitting the CSS and a `tokens.json`** — designed and partly built, then removed the same day at Cory's direction ("we just need a .css theme file with the css vars in it"): a second representation to keep in sync and a build step nobody wanted; the CSS parser in the tests gives the same guarantees.
- **A soft-LIGHT medium** (grey-on-light) — rejected: Pyramid's `mixed` mode, which medium replaces, is dark structure with a lifted panel; medium keeps `color-scheme: dark` so native controls agree.
- **Anchoring the blocks to `:root`** — rejected: scoped previews (picker cards, compare grid) need the blocks to apply to any element.

## Consequences

- Token NAMES are frozen; a rename is a breaking change for Pyramid and Sites.
- Adding a palette means restating every token in a new file and listing it in `registry.json`, `appearance.js`, `pre-paint.js`, `test/lib/parse-theme.mjs` and the demo's `tokenNames.js` — the tests fail until all agree.
- Phase 2 (separate PRs): Pyramid and Sites import the package files, keep only their app-only tokens locally, rename `mixed → medium` (Pyramid) and `data-theme → data-scheme`, `data-mode → data-theme` (Sites), and delete their local drift guards.
