# Puzzle themes: one source of colour for every Puzzle app

Brief for `@magic-spells/puzzle-pieces`. Date 2026-09-18. Decided with Cory over the
course of the day; his words are quoted where they are load-bearing.

## 1. Why

Every Magic Spells app carries its own copy of the same palettes. The pieces registry
ships four colour-only palette files (default, dim, warm, void) as whole-file drop-ins the
CLI cannot even install; the pieces demo duplicates them as `data-scheme` override blocks
with a comment begging for byte-equality; Pyramid, Sites web and Sites admin each carry a
much larger vocabulary on top (frame, bar, rail, panel, card, edge roles, shadows, scrims,
alpha wells) and hand-copy the same pre-paint anti-flash script. When Pyramid re-copied its
palettes from Sites, Dim silently went from blue-slate to neutral grey and nobody decided
that. Cory: "we want to centralize all of the colors across all puzzle apps … so we can
edit the colors in one spot."

Decisions taken (2026-09-18):

- Themes live INSIDE `@magic-spells/puzzle-pieces`, not a separate package. Cory: "we
  integrate the themes into puzzle-pieces repo directly and have the different themes as
  different exports". The tokens are the pieces contract; they version together.
- Tokens are hand-written CSS; the four files in `registry/theme/` are the source of
  truth (Cory, 2026-09-18: "we just need a .css theme file with the css vars in it").
  An earlier draft of this brief called for JS token sources and a generator; that was
  dropped the same day, before anything shipped — people edit the CSS directly.
- Three real modes: `light`, `medium`, `dark`. `mixed` is renamed `medium` and becomes
  its own value set. Cory: "this is a good opportunity to change mixed to medium … the
  Mixed we currently use has a dark sidebar and white main and that's a high contrast that
  people might not like so we need to sort of mellow and balance those out." He picked
  **soft dark** for medium: dark-mode structure with surfaces lifted to mid grey and text
  dimmed a stop — light text on grey, not on black, and not a dark rail against a white
  main.
- The package holds EVERY colour variable the apps share: the pieces core set, the
  alpha/shadow/scrim family, and the shell roles (frame/bar/rail/panel/card/edge) that
  Pyramid and Sites already share verbatim. Fonts, radii, spacing and motion stay per app
  for now.
- Attribute names: `data-scheme` = palette (absent for default), `data-theme` = mode
  (`light | medium | dark`). This is what pieces and Pyramid already use; Sites migrates
  its `data-theme`/`data-mode` when it adopts this.
- The demo app inside the package IS the design-system showcase. Cory: "should we maybe
  include a demo puzzle app in the puzzle-themes repo?" — yes, and pieces already has one
  at `packages/puzzle-pieces/demo/`, so it grows there.
- The internal Puzzle app template lives at `org/design-system/` (Cory moved it there
  2026-09-18: "it's now an official internal org template"). It is a CONSUMER of this
  package, built in phase 2: "a sidebar, main panel, top header bar, right details panel
  like we use in pyramid for the agent chatting." Nothing in this build goes there, but
  the shell roles and the demo's shell view must cover exactly those four regions so the
  template can be styled from the package alone.

## 2. The palettes, in Cory's words

> Default - a nice balance dark mode with navy blue tint that looks classy and premium
> Void - black, dark, like Vercel, higher contrast
> Warm - inspired by claude and anthropic for a warm tan, brown, and orange color
> Dim - not as high contrast as void or default, slightly blue, sort of like warm but the
> blueish grey version.
>
> we don't need to make Dim as blue as it was in puzzle pieces and Constellation, a little
> less blue would be fine but not as neutral grey as it is now.

Reference values the researcher pulled (2026-09-18):

- Registry Dim (the "too blue" one): ink `#1C2536/#E6EBF2`, page `#EEF2F7/#171C26`,
  surface `#FBFCFE/#1E2532`, sunken `#E2E8F1/#27303F`, border `#D5DDE9/#2B3444`, brand
  `#4c6ef5/#5c7cfa`.
- Pyramid/Sites Dim today (the "too grey" one): ink `#2b2b2b/#e4e4e4`, page
  `#f0f0f0/#212121`, surface `#f9f9f9/#272727`, border `#dcdcdc/#343434`, frame
  `#242424/#1a1a1a`.
- Target Dim: hue ≈ 220, chroma about half the registry's, ink pitched a stop softer than
  Default so overall contrast sits below Default and Void while every text role still
  clears WCAG AA (4.5:1 small text on page AND on surface; 3:1 non-text).
- Pyramid Default frame today: `light-dark(#1b1d22, #030406)`; the "navy tint" Cory wants
  is a cool hue on the dark surfaces, not a saturated blue.
- Warm brand `#CC785C` (registry / Constellation "observatory").
- Sites' `themes/dim.css` still carries three old blue rail leftovers
  (`--color-rail: light-dark(#E1E7F0,#1E2532)` …) — a reminder that rail/frame roles are
  part of a palette's identity and must be generated per palette, not aliased once.

## 3. Deliverables (all in `packages/puzzle-pieces`)

### 3.1 The theme files — `registry/theme/`

Four hand-written CSS files, the source of truth. People edit values here and run
`npm test`.

- `pieces.css` — the default palette. Keeps line 2 EXACTLY `* puzzle-pieces design tokens
  (Tailwind v4 @theme).` — the CLI keys installed-detection on the marker
  `puzzle-pieces design tokens` (`compiler/internal/pieces/pieces.go`). Structure: a
  Tailwind v4 `@theme { … }` block declaring every token with `light-dark(light, dark)`
  pairs (so utilities exist for every name and a two-mode app needs nothing else), then
  unlayered blocks: `:root { color-scheme: light dark }`, `[data-theme='light']` /
  `[data-theme='dark']` / `[data-theme='medium']` setting `color-scheme`, a medium block
  re-declaring every token whose medium value differs from the dark half, and the default
  palette restated on `[data-scheme='default']` for preview cards.
- `dim.css`, `warm.css`, `void.css` — scheme OVERRIDES, not drop-ins any more: unlayered
  `[data-scheme='dim'] { … light-dark pairs for EVERY token … }` and a medium block on
  `[data-scheme='dim'][data-theme='medium'], [data-theme='medium'] [data-scheme='dim']:not([data-theme])`.
  Selectors are NOT anchored to `:root` because the Appearance UIs scope `data-scheme` on
  preview cards (Pyramid's `appearance-tokens.test.mjs` asserts this; keep it true).
- Token groups (names exactly as the apps use them today — do NOT rename existing names;
  the whole point is that Pyramid/Sites can switch imports without touching class strings).
  The canonical NAME list lives in `test/lib/roles.mjs` (with each role's contrast
  grounds) and is mirrored, names only, in `demo/app/lib/tokenNames.js`; the tests fail if
  any theme file or either list drifts:
  - text: `ink body muted faint label-ink`
  - surfaces: `page surface surface-sunken surface-raised surface-base`
  - brand: `brand brand-dark brand-tint brand-ink brand-on-tint`
  - status: `danger danger-dark danger-tint danger-ink danger-on-tint success success-tint
    warning warning-tint`
  - lines: `border border-strong border-dashed ring`
  - charts: `chart-1 … chart-8` (fixed slot order, colour-blind validated — keep the
    registry's values unless a palette demands otherwise)
  - shell (the roles Pyramid + Sites share verbatim): `surface-frame frame-light bar
    bar-ink bar-muted bar-hover bar-line surface-panel surface-card rail rail-ink
    rail-muted rail-active rail-edge edge-highlight edge-highlight-strong panel-edge
    shadow-contact`
  - alpha family: `well well-strong well-deep well-deepest scrim scrim-strong` plus the
    shadow colours Pyramid names (`shadow-soft shadow-glow shadow-drop shadow-popover
    shadow-inset text-shadow`) and the box-shadow values `--shadow-float --shadow-contact
    --shadow-panel --shadow-card --shadow-popover`
  - Pyramid-only tokens (studio, github/figma, method-*, canvas, swatch, drop) are NOT in
    scope; they stay in Pyramid.
- Medium mode values: hand-tuned per palette (not a formula) using the rule "soft dark":
  page/surface lifted from near-black to mid-dark greys of the palette's hue (roughly L
  18–26% in OKLCH), frame a touch darker than the panel rather than the black used in
  dark, ink/body dimmed one stop from dark's. The frame-to-panel contrast in medium must
  be visibly lower than in dark and in light (`contrast.test.mjs` measures it in OKLCH L).

### 3.2 Runtime files — also in `registry/theme/`

- `pre-paint.js` — the anti-flash snippet apps inline in `index.html`: reads one
  localStorage key (`puzzle:appearance`, JSON `{ scheme, mode }`), sets `data-scheme`,
  `data-theme` and inline `color-scheme` before first paint. Apps may keep their own key
  by passing it in (`data-key` on the script tag); Pyramid's `pyramid:appearance` must
  remain supported by parameter, and a stored `theme` field / `mixed` mode are read as
  `scheme` / `medium`.
- `appearance.js` — runtime helper: `read()`, `apply({ scheme, mode })`, `set()`,
  `subscribe()`, `boot()`, `configure({ storageKey, fallback })`, the `mixed → medium`
  read-time alias, and `SCHEMES` / `MODES` constants.

Also:
- `registry/registry.json`: the `themes` array becomes truthful (name, file, label,
  description) and the file gains `modes: ["light","medium","dark"]`. The Go `Registry`
  struct does not read it today; note that in the CLI follow-up below, do not change Go here.
- `package.json`: add `exports` so apps can import as a dependency:
  `"./themes/default.css": "./registry/theme/pieces.css"`, `"./themes/dim.css"`,
  `"./themes/warm.css"`, `"./themes/void.css"`, `"./appearance":
  "./registry/theme/appearance.js"`, `"./pre-paint": …`. Update the package description
  (it currently says "never installed or imported directly" — now it is both copy-in AND
  importable; say so). Keep `files: ["registry"]`.
- `demo/app/styles/schemes.css` is DELETED; the demo imports the registry theme files.

### 3.3 Tests — `test/`

- `themes.test.mjs`: parses the four CSS files (shared parser in `test/lib/parse-theme.mjs`
  — test-only, the demo must NOT import it) and asserts every file declares exactly the
  same set of `--color-*`/`--shadow-*` names (the contract in `test/lib/roles.mjs`); scheme
  selectors are unanchored; the marker line is intact; each medium block re-declares the
  grounds and type that make "soft dark" and never restates a value that is already the
  dark half; the demo's `tokenNames.js`, its `appearance.js` copy and its inline pre-paint
  script match the registry.
- `contrast.test.mjs`: parses the CSS the same way (resolves `light-dark()` pairs plus the
  medium block into per-mode maps) and holds WCAG 2.2 AA over every palette × every mode:
  text roles (`ink body muted label-ink bar-ink rail-ink`) ≥ 4.5:1 on `page`, `surface`, `surface-sunken`,
  `surface-frame`/`bar` as applicable; `bar-muted`/`rail-muted` ≥ 4.5:1 on the frame;
  `brand-ink` on `brand`, `danger-ink` on `danger`; non-text (`border`, `ring`) ≥ 3:1.
  `faint` and chart slots excluded (disabled/decorative). Port the maths from Pyramid's
  `web/scripts/contrast-tokens.test.mjs` (it also flattens alpha tints over a ground).
- Existing pieces tests keep passing.

### 3.4 The demo app — `demo/`

The design-system showcase. Cory: "we'll set up a bunch of panels with a sidebar and
center main area and integrate all of the color schemes there. you can have a panel that
shows the values of each of the color schemes with all of their css vars and color cards."

- Shell: sidebar + main area built from pieces (the `sidebar` piece and friends), styled
  with the shell roles so the demo itself shows the frame/rail/panel composition. A live
  scheme × mode switcher in the sidebar foot (4 schemes × 3 modes), persisted with
  `appearance.js`, pre-painted with `pre-paint.js`.
- Views (routes under `/themes/…`, keep the existing docs routes working):
  - **Scheme panel** (one per palette, `/themes/:scheme`): every token, grouped as in
    §3.1, as colour cards: swatch, token name, the three mode values side by side, the
    contrast ratio against its declared ground with an AA pass/fail chip. Copy-to-
    clipboard on the var name. Values come from the LIVE computed styles
    (`getComputedStyle(el).getPropertyValue('--color-…')` on an element scoped to each
    scheme × mode) over the static name list in `demo/app/lib/tokenNames.js` — no JSON
    file, so the cards can never disagree with the stylesheet.
  - **Grid** (`/themes/compare`): all four schemes × three modes as mini shell mocks
    (frame + rail + panel + a card + text samples) in one screen.
  - **Shell** (`/themes/shell`): a full-size frame/rail/panel mock in the current
    scheme+mode with labelled callouts naming the roles.
  - **Pieces** (`/themes/pieces`): a gallery of the registry pieces (button variants,
    inputs, dialog, sidebar, badge, toast) in the current scheme+mode.
- The existing `Theming.pzl` docs page is rewritten to describe the new model (three
  modes, schemes as overrides, the exports, the copy-in path) and to link the panels.
- No hex literals in the demo's `.pzl` files: everything through tokens (port Pyramid's
  `check-theme.mjs` idea as a demo test if cheap).

### 3.5 Docs

- `packages/puzzle-pieces/README.md` and `CLAUDE.md`: the theme model, the exports, how
  to add a palette (write `registry/theme/x.css` restating every token, list it in
  `registry.json`, `appearance.js`, `pre-paint.js` and the two name lists, run the tests), the
  medium rule, the attribute names. Note that the demo imports the registry theme files
  directly rather than keeping copies.
- `packages/puzzle/skills/puzzle/SKILL.md` §Styling: one paragraph on `data-scheme` +
  `data-theme` with three modes and the importable exports.
- `CHANGELOG.md` entry under the package's next version (0.8.0 — a minor: new mode, new
  exports). Do NOT tag or publish.
- Constellation cards in `packages/puzzle-pieces/constellation/`: a DECISION card for
  "themes live in pieces, hand-written CSS, three modes" (with Cory's quotes and the
  rejected alternatives: separate `@magic-spells/puzzle-themes` package; JS token data +
  a generator; soft-light medium), a FEATURE card for this build, and updates to
  DOC-REGISTRY / DOC-DEMO-DOCS-SITE. Use the constellation MCP tools with `repo` = the worktree path;
  never hand-edit card files.

## 4. Out of scope here (follow-ups, each its own PR)

- Puzzle CLI: `puzzle add theme <name>` reading `registry.themes`; installed-detection
  treating an `@import "@magic-spells/puzzle-pieces/themes/…"` as wired; the Go
  `Registry` struct gaining `Themes`.
- Pyramid: switch `web/app/styles/themes/*.css` to the package exports, keep only the
  Pyramid-only tokens locally, `mixed → medium` in `appearance.js` + a server migration
  widening `user_preferences.theme_mode`, delete the local drift guards the package now
  owns.
- Sites web / Sites admin: same, plus the attribute rename (`data-theme`→`data-scheme`,
  `data-mode`→`data-theme`).
- Constellation viewer, account apps, magicspells.io: adopt when touched.
- `org/design-system/`: the internal Puzzle app template (sidebar + top bar + main +
  right details panel), importing this package's themes and appearance helper.

## 5. Verification the builder owes

- `npm test` in `packages/puzzle-pieces` (all suites incl. the two new ones) green.
- Demo: `cd demo && npm install && npx puzzle check && npm run build`; then a headless
  browser pass (the builder's own playwright, never the shared MCP browser) that
  screenshots every scheme × mode of the compare grid and the shell view, reads the
  computed `--color-surface`, `--color-surface-frame`, `--color-ink` for each combination
  and asserts they match the values in the CSS files (parsed with the test parser), and
  reports zero console errors. Screenshots into
  `packages/puzzle-pieces/demo/.playwright/themes/` (gitignored) and the paths in the
  report.
- Pyramid smoke: from a Pyramid worktree, temporarily point `@import`s at the package theme
  files (do not commit) and confirm `npx puzzle check` + the token/contrast scripts run;
  report what would need to change in Pyramid (that is the phase-2 brief's input).

## 6. Git

Puzzle monorepo, worktree off `origin/release/0.8.0` (the open minor), branch
`feat/pieces-themes`, PR against `release/0.8.0`. Never tag, never publish, never merge.
Commit trailers per the repo's conventions plus
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
`Claude-Session: https://claude.ai/code/session_01UpNcrZ3VD7SkCBTTkvUyjU`.
