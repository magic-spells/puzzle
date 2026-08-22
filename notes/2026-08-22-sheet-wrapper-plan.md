# Sheet → wrapper conversion plan (2026-08-22)

Replace the ported `sheet` piece with a thin wrapper over the `@magic-spells/sheet`
web component (plus its `@magic-spells/dialog-panel` peer) — first in puzzle-pieces
(registry + demo + docs + tests), then in `../magic-spells-puzzle-site`. The rule this
implements: `constellation/decision/DECISION-WRAP-WEB-COMPONENTS.md` (CLAUDE.md
"Piece conventions"). `registry/ui/scroll-stack/ScrollStack.pzl` is the exemplar wrapper.

## Branches

- puzzle-pieces: `feat/sheet-wrapper` off `release/0.6.0` → PR into `release/0.6.0`.
  The uncommitted `top`-position work on the ported sheet is parked on
  `wip/sheet-top-position` (commit 9e8cd38). It is NOT in scope — `top` belongs upstream
  in `../sheet`.
- site: `feat/sheet-wrapper` off the current `feat/open-sourcery-library` HEAD
  (`Library.pzl` lives on that branch).

## Upstream facts (verified 2026-08-22 — read the source, don't guess)

- `@magic-spells/sheet@0.1.1` on npm == `../sheet` HEAD (`f8a7379`). ESM build keeps
  its deps external. `import '@magic-spells/sheet'` side-effect-imports dialog-panel
  and registers `sheet-panel`/`sheet-header`/`sheet-content`/`sheet-footer` plus
  `dialog-panel`/`dialog-backdrop`. Module-scope `class extends HTMLElement` →
  **dynamic import in `mounted()` only** (Node prerender crashes otherwise).
- Peer: `@magic-spells/dialog-panel@^2.0.1`. List it explicitly in `piece.json`
  `dependencies` (npm 7+ auto-installs peers; yarn 1 doesn't).
- CSS: TWO stylesheets — `@magic-spells/dialog-panel/css` and `@magic-spells/sheet/css`
  — imported in `layer(components)` so utilities on the host win. The demo (puzzle
  0.6.0) resolves package subpath exports (`@import "@magic-spells/scroll-stack/css"
  layer(components)` already builds); the site (puzzle 0.5.0) does NOT → explicit
  `../../node_modules/@magic-spells/<pkg>/dist/<pkg>.css` paths there (see the
  comments already in `site/app/styles/styles.css`).
- Canonical markup (README "Usage"):
  `<dialog-panel><dialog-backdrop></dialog-backdrop><dialog aria-labelledby="…"><sheet-panel …attrs><sheet-header>…</sheet-header><sheet-content>…</sheet-content><sheet-footer>…</sheet-footer></sheet-panel></dialog></dialog-panel>`.
  Author `<dialog-backdrop>` in the template — dialog-panel injects one only when
  absent (`dialog-panel.js:62-66`), so authoring it keeps every node vdom-owned.
- `sheet-panel` attributes: `snap-points`, `initial-snap`, `position`, `mode`,
  `breakpoint`, `desktop-position`, `desktop-mode`, `effect`, `exit-effect`,
  `desktop-effect`, `desktop-exit-effect`, `dismiss` (read live), `max-display-width`,
  `spring`, `morph-trigger` (boolean).
- Methods: `sheetPanel.show(triggerEl?)` (trigger = focus-return target; with
  `morph-trigger` also the morph origin), `.hide()`, `.snapTo(i)`, `.activeSnap`.
  dialog-panel: `.isOpen`, `.state` (`hidden|showing|shown|hiding`).
- Events — on `dialog-panel`: `beforeShow`, `shown`, `beforeHide`, `hidden` with
  `detail = { result, triggerElement }` where `result` is the `data-result` of the
  `[data-action-hide-dialog]` button that closed it (null for escape / backdrop /
  swipe). On `sheet-panel`: `snapchange` (detail has the index), `snaprelease`.
- Theme CSS vars (defaults in `sheet.css:1-45`): `--sheet-panel-background` (white),
  `--sheet-handle-color` (#bbb), `--sheet-overlay-background` (rgba(0,0,0,.5)),
  `--sheet-overlay-blur` (5px), `--sheet-panel-box-shadow`, `--sheet-footer-background`,
  `--sheet-desktop-panel-width` (min(26rem,90vw)), `--sheet-center-width`,
  `--sheet-content-padding` (20px), `--sheet-footer-padding`, `--sheet-card-margin`,
  `--sheet-panel-border-radius`, `--sheet-card-border-radius`, handle sizes,
  `--sheet-morph-duration`, `--sheet-exit-cushion`, `--sheet-trigger-return-*`.
- The handle is `sheet-header::before` (bottom) / `sheet-panel::before` (sides); auto-
  hidden on the desktop profile and under `@media (pointer: fine)`.
- `sheet-panel:has(sheet-footer)` rules exist only for side-sheet safe-area insets and
  would match an EMPTY `<sheet-footer>` too — cosmetic; `class="empty:hidden"` on the
  footer is enough for now (upstream `:not(:empty)` tweak is a follow-up).

## Wrapper spec — `registry/ui/sheet/Sheet.pzl`

Template: the canonical markup above, with `ref`s on `dialog-panel` and `sheet-panel`.

Props (every attribute prop renders NO attribute when unset — ScrollStack's `attr()`
helper — so upstream defaults apply):

- `open` (bool). **Edge-triggered**: act only when the prop CHANGES — true → `show(trigger)`,
  false → `hide()`. Never level-triggered (an unrelated re-render must not re-open a
  sheet the user closed while the parent still says `open=true`). Before the package
  has upgraded (import pending), remember the desired state and apply once.
- `@show()` from `shown`; `@hide({ result, triggerElement })` from `hidden`. This
  REPLACES the port's `@close(reason)`. The sheet closes itself on escape / backdrop /
  swipe / `[data-action-hide-dialog]` buttons and reports; the parent re-syncs `open`.
- `title` (stock header fallback `<h2>` with a generated id), `labelledby` (→
  `aria-labelledby` on `<dialog>`; defaults to the generated title id when `title` is
  set). Named slots `header` / `footer` (inside `<sheet-header>` / `<sheet-footer>`),
  `<Children/>` inside `<sheet-content>`. `<sheet-header>` always renders (it hosts the
  grabber pseudo-element). `<sheet-footer class="empty:hidden">`.
- Attribute props: `snapPoints` (string, or array → space-joined), `initialSnap`,
  `position`, `mode`, `breakpoint`, `desktopPosition`, `desktopMode`, `effect`,
  `exitEffect`, `desktopEffect`, `desktopExitEffect`, `dismiss`, `maxDisplayWidth`,
  `spring`.
- `morphTrigger` (CSS selector or Element): sets the `morph-trigger` attribute and is the
  element passed to `show()`. Without it, pass `document.activeElement` (if it is an
  HTMLElement) so focus returns — same behavior as the port.
- `snap` (optional-controlled index): on change → `snapTo(snap)`; `@snapChange(index)`
  from `snapchange`.
- `showGrabber={ false }`: CSS-only — zero `--sheet-handle-height`,
  `--sheet-handle-offset`, `--sheet-handle-side-thickness` via arbitrary-property
  utilities on `sheet-panel`. (Upstream `handle="none"` is the nicer follow-up.)
- `class` → merged onto `<sheet-panel>`; `backdropClass` → `<dialog-backdrop>`;
  `style` passthrough → `<sheet-panel>` after the piece's own declarations.
- Theme bridge: set the token vars on the ROOT `<dialog-panel>` (the backdrop reads
  `--sheet-overlay-background` and must inherit it): panel bg → `var(--color-surface)`,
  handle → `var(--color-faint)`, overlay → the look the port used (`bg-black/50` +
  `backdrop-blur-sm`, i.e. `rgb(0 0 0 / 0.5)` + 4px blur), keep upstream's shadow.
  Tailwind arbitrary-property utilities (`[--sheet-panel-background:var(--color-surface)]`);
  **no `<style>` block**, no hex.
- Loading: `mounted()` → `await import('@magic-spells/sheet')`, then bind listeners on
  the refs and apply the pending open state. `destroy()`/unmount: remove listeners; a
  sheet that is open when its view unmounts must not throw (dialog-panel's
  disconnectedCallback cleans up; guard `hide()` with `isOpen`).
- Header comment: rewrite for the wrapper in the ScrollStack style — WRAPPER NOT PORT +
  why, the self-close/notify contract, `data-result` pattern, loading, the two
  stylesheet imports, theme vars, markup contract, known gaps. Target ~250–350 lines
  for the whole file.
- Prerender safety: no top-level import of the package. Compile and grep the output:
  no `customElements` reachable at module scope.

## Manifests

`piece.json`: `files: ["Sheet.pzl"]`, `registryDependencies: []`,
`dependencies: ["@magic-spells/sheet", "@magic-spells/dialog-panel"]`, description
rewritten to say it wraps the `@magic-spells/sheet` web component (one clean sentence —
it is the docs subtitle). Mirror the entry in `registry/registry.json` (hand-aggregated
index; keep alphabetical; `version: 1` untouched).

## Delete

`registry/lib/sheet-engine.js`, `sheet-policy.js`, `sheet-drag.js` and their
`demo/app/lib/` copies. KEEP `sheet-math.js` (bottom-sheet uses it). Tests: delete
`test/sheet-engine.test.js`, `drag-gesture.test.js`, `scroll-policy.test.js`,
`snap-points.test.js`, `sheet-component.test.js`; trim the three lib rows from
`sheet-parity.test.js`; update `all.test.js`. Add a small static guard test
(`test/sheet-wrapper.test.js`): piece.json deps include both packages, registry.json
entry matches piece.json, `Sheet.pzl` has no top-level `import … '@magic-spells/sheet'`
and no `customElements`. Root `package.json` devDeps: drop `@magic-spells/physics-engine`
/ `frame-engine` only if no remaining test imports them (check `sheet-math.test.js`).

## Demo

- `demo/package.json`: add `@magic-spells/sheet: ^0.1.1`, `@magic-spells/dialog-panel:
  ^2.0.1`; `npm install`. (Don't switch to `file:` links unless an upstream change turns
  out to be required — then say so.)
- `demo/app/styles/styles.css`: two `@import "@magic-spells/…/css" layer(components);`
  lines next to scroll-stack's, with a short comment.
- `demo/app/components/ui/Sheet.pzl` byte-identical to the registry file.
- `demo/app/views/components/SheetDoc.pzl`: Installation (`npm install
  @magic-spells/sheet` — dialog-panel is a peer npm 7+ installs automatically; the two
  CSS imports; "copy-in + wrapper" note like ScrollStackDoc), props/callbacks table for
  the new API, every example moved from `@close(reason)` to `@hide`, one example
  showing footer buttons with `data-action-hide-dialog data-result="…"` and reading
  `result`, remove props that no longer exist (`exitCushion`, `morphDuration`,
  `morphEasing`, `blobZIndex`, `triggerReturn*` → "CSS custom properties" note).
  Keep the example count and the page's nav/anchors consistent with the exemplar docs.
- `cd demo && npm run build` clean; commit `demo/dist`. Browser smoke at 3070 in a
  FOREGROUNDED tab.

## CLAUDE.md touch-ups (same PR)

"Node tests" paragraph (sheet motion libs are gone; `sheet-math` + parity remain);
`piece.json` dependency examples (`sheet` → `@magic-spells/sheet` + `dialog-panel`;
`bottom-sheet` keeps physics-engine); anything else naming the deleted libs.

## Site (after the pieces branch is verified)

Branch; `scripts/copy-pieces.sh`; delete the stale `app/lib/sheet-engine.js` /
`sheet-policy.js` / `sheet-drag.js` (the copier never deletes); `scripts/port-puzzle-
pieces.mjs` (re-ports SheetDoc + nav/routes); `package.json` deps + `npm install`;
`styles.css` explicit-path imports with `layer(components)`; update
`app/components/landings/opensourcery/SheetDemo.pzl` and `app/views/landings/Library.pzl`
(`@close` → `@hide`; the footer Close button may become `data-action-hide-dialog`);
`npm run build` (SSG — must pass; the dynamic import is what keeps prerender alive);
smoke at 3080; `cmp` registry↔site copies byte-identical.

## Upstream follow-ups (`../sheet`, NOT this plan)

`top` position (from `wip/sheet-top-position`); `handle="none"`; a `reason` in the
`hidden` detail (escape/backdrop/swipe); `sheet-panel:has(sheet-footer:not(:empty))`;
stripping the color defaults from `sheet.css` (owner preference — breaking for plain
web-component users, decide separately). The wrapper must work against 0.1.1 as-is.

## Verification (Claude, not the implementing agent)

Diff review; `npm test` green at the root; demo build; browser smoke of every SheetDoc
example (open/close, Escape, backdrop, snap buttons, desktop profile switch, morph
trigger, `data-result`); site build + smoke; parity `cmp`.
