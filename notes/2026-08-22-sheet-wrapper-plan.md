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

### Found during verification (2026-08-22) — upstream, not the wrapper

- **Keyboard activation of a `[data-action-hide-dialog]` button loses its `data-result`.**
  Mouse click on "Delete project" → `hidden.detail.result === 'delete'`; Tab + Enter on the
  same button → the sheet closes but `result === null`. Cause: a keyboard click has
  `clientX/Y = 0,0` and `event.detail === 0`; `sheet.js` `outsideGuard` (~L430-452)
  deliberately lets it through so keyboard users can close, but dialog-panel's `dialogClick`
  on the `<dialog>` (bubble, BELOW the delegated `[data-action-hide-dialog]` handler on
  `<dialog-panel>`) reads (0,0) as outside, calls `hide()` with no trigger and
  `stopPropagation()`s — so the delegated handler that would have passed the trigger never
  runs. One-line fix in `dialog-panel.js` `#bindEvents` `dialogClick`: ignore clicks with
  `detail === 0` (a pointerless click can never be a scrim tap); the sheet's pointerless
  guard then only has to protect non-closing controls. Affects the plain web component too.

- **bottom-sheet 2.0.2 paints two overlays.** Its `dialog-panel:has(bottom-sheet) > dialog-backdrop
  { display:none }` (0,0,3) loses to dialog-panel 2.0.1's `dialog-panel[state='shown'] >
  dialog-backdrop { display:block }` (0,1,2), so dialog-panel's 30% backdrop paints under the
  component's own 50% `dialog::backdrop` scrim (overlay reads darker; `backdropClass` is inert).
  Already fixed on `../bottom-sheet` main (scrim moved onto `<dialog-backdrop>`,
  `--bs-backdrop-progress` added) — **publish 2.0.3**, then bump the piece/demo range.
- **bottom-sheet's ESM bundle does not side-effect-import its dialog-panel peer** (sheet's does).
  The wrapper imports both packages in `mounted()`; upstream could add the import for parity
  with sheet so consumers of the plain component get one-import installs too.

## Verification (Claude, not the implementing agent)

Diff review; `npm test` green at the root; demo build; browser smoke of every SheetDoc
example (open/close, Escape, backdrop, snap buttons, desktop profile switch, morph
trigger, `data-result`); site build + smoke; parity `cmp`.

## Phase 2 — bottom-sheet → wrapper (same branch, AFTER the sheet wrapper is reviewed)

Decided 2026-08-22 (owner): `bottom-sheet` also becomes a wrapper, over
`@magic-spells/bottom-sheet` (npm 2.0.2 == `../bottom-sheet`; HEAD has two small
post-bump commits — ask the owner to publish 2.0.3 before pinning if they matter).
Peer `@magic-spells/dialog-panel >=2 <3` (the SAME module the sheet wrapper loads —
one copy, guarded registration), dep `@magic-spells/physics-engine`. Elements:
`bottom-sheet`, `bottom-sheet-header`, `bottom-sheet-content`, `bottom-sheet-footer`.

- Template the wrapper on the finished `Sheet.pzl`: same loading (dynamic import in
  `mounted()`), same edge-triggered `open`, same `@show` / `@hide({ result,
  triggerElement })` contract via dialog-panel's events, same theme-bridge approach
  (read `../bottom-sheet/src/bottom-sheet.css` for its `--bottom-sheet-*` vars), same
  `title` / `labelledby` / header + footer slots. Map attributes from
  `../bottom-sheet/src/bottom-sheet.js` observedAttributes; map snap events/methods.
- Delete `BottomSheet.pzl`'s port, `registry/lib/sheet-math.js` (bottom-sheet is its
  only consumer) and `test/sheet-math.test.js`; trim the remaining rows from
  `sheet-parity.test.js` (or delete it if empty) and `all.test.js`; extend the static
  guard test. Root devDeps: drop physics/frame-engine if nothing imports them.
- `piece.json` / `registry.json`: `registryDependencies: []`, `dependencies:
  ["@magic-spells/bottom-sheet", "@magic-spells/dialog-panel"]`.
- Demo: dep `@magic-spells/bottom-sheet ^2.0.2`; one more stylesheet import
  (`@magic-spells/bottom-sheet/css` — verify the export name in its package.json) in
  `layer(components)`; rewrite `BottomSheetDoc.pzl` (7 examples) to the new API;
  build + smoke. CLAUDE.md: the bottom-sheet/physics-engine dependency example.
- Site phase then syncs BOTH pieces in one pass (copy, delete stale libs incl.
  `sheet-math.js`, port docs, deps, two+one stylesheet imports, build, smoke).

## Phase 3 — dialog (+ alert-dialog) → wrapper over `@magic-spells/dialog-panel` (after phase 2)

Decided 2026-08-22 (owner): the `dialog` piece is based directly on dialog-panel too, so
all three overlays (sheet, bottom-sheet, dialog) share one upstream base, one loaded
module, and one close/notify contract. Upstream `@magic-spells/dialog-panel@2.0.1`
(npm == `../dialog-panel` — verify HEAD hasn't drifted; publish first if it has).
Elements `dialog-panel` + `dialog-backdrop`; attrs `block`, `morph-display`; methods
`show(triggerEl)` / `hide(triggerEl)`; events `beforeShow` / `shown` / `beforeHide`
(cancelable, `{ result, triggerElement }`) / `hidden`; `state` attribute drives the CSS
transitions; scroll lock; focus return to the trigger; `[data-action-hide-dialog]`
delegation (`data-result` → `hidden.detail.result`). CSS: 287 lines, one var
(`--dialog-backdrop-z-index`), backdrop `rgba(0,0,0,.3)`.

- `Dialog.pzl` (296 lines today, `@magic-spells/morph-engine` dep) → wrapper:
  `<dialog-panel><dialog-backdrop/><dialog aria-labelledby aria-describedby>` with the
  piece's title / description / footer slots and close X, same edge-triggered `open`,
  `@show` / `@hide({ result, triggerElement })` contract as the Sheet wrapper. Panel
  chrome (bg-surface, radius, shadow, max-w, padding) stays Tailwind on the `<dialog>`;
  read `dialog-panel.css` first and do NOT set `transform` / `opacity` / `transition` /
  `display` on the dialog — those belong to dialog-panel's state machine.
- `dismissible={ false }`: dialog-panel has no backdrop/Escape opt-out → the wrapper
  cancels `beforeHide` when `detail.triggerElement` is null AND the hide was not its own
  (set a flag around its own `hide()` call). A `reason` in the upstream detail is the
  cleaner follow-up.
- `morph` prop: morph-engine has NO dialog-panel seam (the sheet implements dialog-
  panel's duck-typed `{show, hide, state, on, off}` seam inside its own engine).
  RECOMMENDED: drop `morph` from Dialog — a morphing centered dialog IS
  `<Sheet position="center" morphTrigger="…">`; say so in DialogDoc. Alternative if
  the owner wants it kept: a ~40-line adapter implementing the seam over MorphEngine,
  assigned to `panel.morphEngine`. OWNER TO CONFIRM before phase 3 starts.
- `AlertDialog.pzl` (164 lines, no deps): a thin variant of the Dialog wrapper —
  `role="alertdialog"`, backdrop does not dismiss, Escape still cancels. Escape vs
  backdrop can't be told apart from `beforeHide` alone → listen to the `<dialog>`'s
  `cancel` event in the CAPTURE phase (it runs before dialog-panel's handler) to flag
  an escape. If that glue gets ugly, keep AlertDialog as a port for now and say so.
- Manifests: `dependencies: ["@magic-spells/dialog-panel"]` (drop morph-engine if
  `morph` is dropped). Demo: make dialog-panel a direct dep; rewrite `DialogDoc.pzl`
  (9 examples) and `AlertDialogDoc.pzl`; the dialog-panel stylesheet import is already
  there from phase 1. Site: `app/views/examples/BankingDemo.pzl` uses Dialog /
  AlertDialog — update those call sites in the site phase.
- Nothing else in the registry imports `Dialog.pzl` (only the old Sheet port mentioned
  it in a comment), so no composite piece breaks.
