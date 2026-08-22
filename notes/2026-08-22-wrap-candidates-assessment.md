# Wrap-candidate assessment — registry pieces vs their `@magic-spells` web components

Date: 2026-08-22
Scope: every registry piece with a sibling `@magic-spells/*` web-component repo under
`/Users/coryschulz/Code/@magic-spells/`.
Rule under assessment: [[DECISION-WRAP-WEB-COMPONENTS]] (2026-08-22) — wrap the web
component whenever possible, port only when wrapping genuinely can't work.

**`sheet` is deliberately excluded** — it is being converted to a wrapper in parallel by
another agent. `bottom-sheet` is assessed but its verdict is entangled with that work.

---

## 1. Summary table

Sizes are source lines: piece = `.pzl` (+ registry lib), upstream = `src/*.js` (+ CSS).
"Self-mutating" = does the component create/move/destroy light-DOM children.

| Piece | Upstream | Published | Light/Shadow | Self-mutating | Piece vs upstream | Verdict | Effort |
|---|---|---|---|---|---|---|---|
| `panel-stack` | `panel-stack` 0.1.0 | yes | light | **no** (attrs only) | 215+52 vs 305+130 | **WRAP NOW** | S–M |
| `split-panel` | `split-panel` 0.1.0 | yes | light | inserts `<split-divider>` between children | 708 vs 570+121 | **WRAP NOW** | M |
| `dialog` | `dialog-panel` 2.0.1 | yes | light | creates `<dialog-backdrop>` (pre-authorable) | 296 vs 669+287 | **WRAP LATER** | M–L |
| `bottom-sheet` | `bottom-sheet` 2.0.2 | yes | light | no | 1123+180 vs 1292+302 | **WRAP LATER** | L |
| `marquee` | `scrolling-content` 2.0.0 | yes | light | adopts pre-authored track; clones unguarded | 364 vs 476+67 | **WRAP LATER** | M |
| `alert-dialog` | `dialog-panel` 2.0.1 | yes | light | (as above) | 164 vs 669+287 | **KEEP PORT** | — |
| `quantity-input` | `quantity-input` 1.0.2 | yes | light | global `<style>` into `head` only | 131 vs 87+50 | **KEEP PORT** | — |
| `tabs` | `tab-group` 1.1.0 | yes | light | **generates + `innerHTML`s panels** | 200 vs 381+19 | **KEEP PORT** | — |
| `collapsible` / `accordion` | `collapsible-content` 1.1.1 | yes | light | **no** (creates nothing) | 187+235 vs 301+31 | **KEEP PORT** | — |
| `popover` / `dropdown-menu` / `hover-card` | `dropdown-panel` 1.0.0 | yes | light | **no** (creates nothing) | 199+334+302 vs 216+83 | **KEEP PORT** | — |
| `select` | `select-dropdown` 0.2.0*, `dropdown-select` 0.3.0 | partly | light | caret injection | 655 vs 896+140 / 565+150 | **KEEP PORT** | — |
| `combobox` / `multi-select` | **no counterpart** | — | — | — | 774+848 vs — | **KEEP PORT** | — |
| `slider` | `range-slider` (unpublished) | **no** | light | **rebuilds rail via `innerHTML=''`** | 842+214 vs 959+142 | **KEEP PORT** | — |
| `toast` | `notification-stack` (unpublished) | **no** | light | generates every card; **auto-removes** children | 140+227 vs 725+335 | **KEEP PORT** | — |
| `date-picker` / `calendar` / `date-range-picker` | `date-picker` (unpublished) | **no** | light | generates the panel (guarded, in-place re-render) | 532+883+547 vs 1983+464 | **KEEP PORT** | — |
| `carousel` | `tarot` monorepo (all pkgs unpublished) | **no** | light | **`replaceChild` rewraps slides** | 459 vs ~4000+555 | **KEEP PORT** | — |
| — | `image-zoom` 0.1.0 | yes | light | no | **no piece** | new wrapper piece (opportunity) | — |
| — | `scroll-progress` 1.1.0 | yes | light | no | **no piece** | new wrapper piece (opportunity) | — |
| — | `load-content` 0.2.0 | yes | light | yes | **no piece** | no piece needed | — |
| — | `focus-trap` 1.0.7 | yes | light | injects sentinels | **no piece** | utility, not a piece | — |
| — | `color-picker` (unpublished) | **no** | light | generates its panel | **no piece** | not yet | — |

\* `select-dropdown` local is 0.2.0 but npm's latest is **0.1.0** — local is ahead of what a
consumer could install.

---

## 2. The shared technical finding that drives every verdict

The brief supplied three facts (patcher diffs only rendered attributes; no `island` needed;
consumer cost is npm install + stylesheet import). Investigating the priority pairs surfaced
a **fourth** that the decision card does not yet state, and it is the sharpest sorting
criterion available:

> **Wrapping is safe when the component only sets attributes/inline styles on itself or on
> slotted children. It becomes hazardous the moment the component inserts, moves, or
> destroys nodes *among* template-rendered siblings.**

Why, precisely:

- `patchIndexedChildren` (`puzzle/client-runtime/views/viewManager.js:987-1002`) walks
  `oldChildren[i]` against `newChildren[i]` using cached `vnode.el` references. It never
  reads `el.childNodes`. So for a **fixed, unkeyed** child list, foreign nodes interleaved
  by a custom element are invisible to the patcher and survive untouched. This is why
  ScrollStack works.
- `patchKeyedChildren` is different. Its move-guard is
  `if (nextPersistentSibling(newChild.el) !== ref) el.insertBefore(newChild.el, ref)`
  (`viewManager.js:1169`), and `nextPersistentSibling` (`viewManager.js:1188-1192`) only
  skips elements mid-leave-animation — **it does not skip foreign injected nodes.** An
  injected `<split-divider>` sitting between two keyed `<split-panel>` siblings therefore
  makes the guard fire on *every* patch, re-inserting panels ahead of the dividers and
  progressively reordering the DOM.
- Appending is also unguarded: a newly added child is mounted with `tail = null`, i.e.
  appended at the very end of the parent (`viewManager.js:999`), landing *after* any
  trailing injected node.

Practical rules that follow, and that each verdict below is scored against:

1. **Creates nothing** → wrap freely (panel-stack).
2. **Creates one node the template can pre-author** → wrap, pre-author it (dialog-panel's
   backdrop; the decision card already records this).
3. **Creates nodes between siblings** → wrap only with a *static, unkeyed* child list, or
   fix upstream to reuse authored nodes (split-panel).
4. **Moves or clones the author's children into a generated wrapper** → do not wrap until
   upstream can accept pre-authored structure (scrolling-content).
5. **Generates the children outright and `innerHTML`s them** → never wrap; the piece's whole
   value is its token-styled markup (tab-group, range-slider, notification-stack,
   date-picker, color-picker).

**Independent corroboration.** This is not a theory derived only from reading the patcher.
`@magic-spells/tarot` already ships a Puzzle binding (`packages/tarot-puzzle/`), and its design
notes reach the same conclusion from the other direction: `docs/DESIGN.md:68-73` requires slot
children to be pre-authored, keyed `<tarot-slide>` elements because "bare children get
rewrapped by tarot via `replaceChild`, **corrupting Puzzle's vnode↔DOM links (ghost slides on
removal, broken keyed moves)**". `docs/PUZZLE-FRICTION.md:62-67` lists the four properties it
audited to make a shared subtree safe, and `:79-82` notes a clone-based library (Swiper) could
not be wrapped this way at all. That file is the best existing prior art for this whole
exercise and is worth reading before the first conversion.

A second cross-cutting criterion: **an unpublished upstream cannot be wrapped at all**, since
`piece.json.dependencies` resolves from npm for every consumer. That alone settles `slider`,
`toast`, `date-picker`/`calendar`/`date-range-picker`, and `carousel`.

Third — and this turned out to be the single most under-appreciated constraint —
**most of these components cannot be driven by attributes at all.** ScrollStack wraps cleanly
because `@magic-spells/scroll-stack` is *attribute-driven*: every prop maps to an attribute and
the component reacts. Survey of the rest:

| Upstream | `observedAttributes` | Drivable by re-rendering? |
|---|---|---|
| `split-panel` | `['direction','disabled']` + real `attributeChangedCallback` (`split-panel-group.js:14`, `:56-66`) | partly, plus `setSizes()` |
| `panel-stack` | none — `initial`/`effect` read once or CSS-only | no; methods + events only |
| `dialog-panel` | **none, and no `attributeChangedCallback`** | no; `show()`/`hide()` only |
| `dropdown-panel` | **none** | no; `toggle()`/`show()`/`hide()` only |
| `collapsible-content` | `['group']` only (`:28-30`) | no; `collapsed` setter only |
| `tab-group` | **none** | no; `setActiveTab(i)` only |
| `dropdown-select` | `['position']` **with no `attributeChangedCallback` — the observed attribute does nothing** (`:20-22`) | no |
| `select-dropdown` | **none** | no; `value` setter only |

A Puzzle wrapper's natural idiom is "render props as attributes and let the patcher do the
rest". Where that is unavailable, the wrapper has to reach into `mounted()`/`afterUpdate()` and
call imperative methods, reconciling against state it cannot observe — which is precisely the
"more glue than the port" exit condition. **This, not size, is what disqualifies most of the
list.**

Fourth: **a wrapper can only expose callbacks the component actually emits.** `dropdown-panel`
dispatches **no events at all** (verified: zero `dispatchEvent`/`CustomEvent` in its entire
`src/`), and `collapsible-content` emits only `collapsible-error` on a markup failure — no
toggle event. Pieces whose contract is `@show`/`@hide`/`@change` therefore cannot be built over
them without a `MutationObserver` on the component's own attribute writes.

Fifth: **the demo wires wrappers to local sibling checkouts.** `demo/package.json` has
`"@magic-spells/scroll-stack": "file:../../scroll-stack"`. A green `npm run build` in `demo/`
therefore does **not** prove the published tarball works. Any conversion must be smoke-tested
against the real npm version before the piece ships.

---

## 3. Per-pair evidence

### 3.1 `panel-stack` → `@magic-spells/panel-stack` — **WRAP NOW (S–M)**

**Upstream.** `/Users/coryschulz/Code/@magic-spells/panel-stack`, `@magic-spells/panel-stack`
0.1.0, published (npm 0.1.0, modified 2026-08-19 — same week as scroll-stack). Source:
`src/panel-stack.js` 305 lines + `src/panel-stack.css` 130 lines. Light DOM, no
`attachShadow` anywhere.

**Self-mutation: none.** This is the cleanest wrap target in the whole registry.
`#queryDOM()` (`panel-stack.js:164`) only *reads* `:scope > stack-panel`. `#setPanelState()`
(`panel-stack.js:228`) only calls `setAttribute('state', …)` and `setAttribute/removeAttribute('inert')`.
No `createElement`, no `appendChild`, no `innerHTML` in the file. The template never renders
`state` or `inert`, so `patchAttrs` never contests them (case 1 above).

**API.** Attributes `initial`, `effect="stack"`. Methods `push(handle, trigger)`, `pop()`,
`reset()`, getters `currentHandle` / `currentPanel` / `depth`. Events (bubbles + composed,
`panel-stack.js:260`): `panel-stack:push` `{fromHandle, toHandle}` (cancelable),
`panel-stack:pop` `{fromHandle, toHandle}`, `panel-stack:reset` `{rootHandle}`. No peer deps,
no dependencies.

**Stylesheet is ideal for wrapping:** 130 lines, **31 CSS custom properties, 0 hex colors**
(one bug aside, below) — every state's translate/scale/blur/opacity/z-index is a `--ps-*`
knob. It is pure motion, no theming to fight.

**Piece.** `registry/ui/panel-stack/PanelStack.pzl` 215 lines + `registry/lib/panel-stack.js`
52 lines = **267 lines**. Controlled: the parent owns the `stack` array and the piece only
*proposes* `@change(nextStack, {type, fromHandle, toHandle})`. Panels are parent-authored
`<div data-stack-panel="x" class={ panelClass(stack, x) } inert={ panelInert(stack, x) }>`.
`lib/panel-stack.js` re-expresses upstream's entire CSS as Tailwind arbitrary values — and
its own header comment flags the exact CLAUDE.md footgun it has to dodge
(`transition-[translate,scale,…]`, because Tailwind v4's `translate-x-*` sets the `translate`
property, not `transform`). That is fork-maintenance debt with no upside.

**Delegated triggers are already identical.** `data-action-stack-push` / `target` /
`data-action-stack-pop` are the same contract in both (`panel-stack.js:191-210` vs
`PanelStack.pzl` `handleClick`). Consumer trigger markup would not change at all.

**Size after conversion:** wrapper ≈ 70 lines (render `<panel-stack initial= effect=>` +
`<Slot/>`, dynamic-import in `mounted()`, forward three events to callbacks) and
`registry/lib/panel-stack.js` **deletes entirely**. 267 → ~70, and the per-panel
`class={…}` / `inert={…}` plumbing vanishes from every consumer call site.

**Two upstream fixes are required first — both blockers, both small:**

1. `panel-stack/src/panel-stack.css:84` is `background: blue;` — a debug leftover. It is
   **in the published tarball** (`dist/panel-stack.css` contains `background: #00f`). Every
   panel would paint blue. Must be removed (or turned into a `--ps-panel-background`
   defaulting to `transparent`) before any consumer wraps this.
2. `panel-stack/src/panel-stack.css:2-4` hides `panel-stack:not(:defined)` and
   `stack-panel:not(:defined)` with `visibility: hidden`. That is correct for a
   script-tag Shopify theme but wrong for Puzzle: on static/hybrid prerender the entire
   stack renders **invisible** until the dynamic import lands. ScrollStack has no such rule
   (`scroll-stack.css` — verified, none), which is exactly why its prerender degrades
   gracefully. Needs to become `[hidden-until-defined]`-opt-in, or be dropped.

**Main risk.** `#queryDOM()` runs once from `connectedCallback` (`panel-stack.js:46-53`) and
there is no `MutationObserver`. Panels added later by a Puzzle `{#if}`/`{#for}` would never
register. Either document "panel set must be static", or add a public `refresh()` upstream.

**Secondary cost.** The piece loses parent-owned `stack`; the component self-manages and
reports. [[DECISION-WRAP-WEB-COMPONENTS]] explicitly sanctions this for wrapped overlays. It
does mean rewriting the one real downstream consumer,
`magic-spells-puzzle-site/app/components/landings/opensourcery/PanelStackDemo.pzl` (which
imports `panelClass`/`panelInert` at lines 148-149), plus `PanelStackDoc.pzl` (3 examples,
328 lines, 14 `data-stack-panel` sites).

---

### 3.2 `split-panel` → `@magic-spells/split-panel` — **WRAP NOW (M)**

**Upstream.** `@magic-spells/split-panel` 0.1.0, published (npm 0.1.0, modified 2026-08-19).
`src/components/split-panel-group.js` 570 lines + `split-panel.js` 23 + `index.js` 4 +
`styles/split-panel.css` 121. Light DOM. Actively developed (last commit 2026-08-19).

**Self-mutation: one generated node type, between siblings.** `#createDividers()`
(`split-panel-group.js:191-205`) removes every existing `:scope > split-divider` and then
`panel.after(divider)` for each adjacent pair. Everything else is attributes/inline style on
children the author owns: `#mirrorConstraints()` (`:225`) writes `panel.style.minWidth/maxWidth/…`,
`#applySizes()` (`:302`) writes `panel.style.setProperty('--split-panel-size', …)`, and
`#trackVisible()` (`:266`) writes `--split-panel-visible`.

This is case 3 from §2. It is **safe with the piece's current two-slot API**: the wrapper
template renders exactly two unkeyed `<split-panel>` children, so `patchIndexedChildren`
never touches DOM order and the divider between them is never disturbed. It becomes unsafe
only if the piece exposes N-panel authoring with `key=` on the panels.

The inline-style writes impose one documented contract, identical to ScrollStack's: **do not
put a dynamic `style={…}` binding on a `<split-panel>`**, or `patchAttrs` will rewrite the
whole style attribute and clobber `--split-panel-size`.

**API (README-documented, and a superset of the piece).** Group attributes: `direction`,
`disabled`, `snap` (space/comma-separated travel percentages; bare = `0 50 100`), `id`
(opts into localStorage persistence). Panel attributes: `size` (`30`, `30%`, or `250px`),
`min`, `max`. Divider: `disabled` (per-divider lock — the piece has no equivalent). Methods:
`sizes` getter, `setSizes(array)`, `resetSizes()`, `disabled` getter/setter. Events:
`split-panel:resize` `{sizes, divider}` live, `split-panel:resize-end`
`{sizes, divider|null}` on commit. Keyboard: arrows 1%, Shift+arrow 10%, Home/End, Enter =
reset pair; double-click = reset pair. All of that already matches the piece one-for-one.

**Stylesheet.** 121 lines, 11 custom properties, 4 hex colors — and all four are *behind*
custom properties declared on `:root` (`--split-panel-divider-color: #ddd`,
`--split-panel-divider-hover-color: #bbb`, `--split-panel-divider-active-color: #4299e1`,
`--split-panel-focus-ring-color: #4299e1`). Retheming is a one-line host declaration
(`--split-panel-divider-color: var(--color-border)`), exactly the pattern the decision card
prescribes. The rest is structural: `split-panel { flex: var(--split-panel-size, 1) 1 0%; }`,
`split-panel-group[dragging] > split-panel { transition: none; }`, and the genuinely
hard-won `split-panel-group[dragging] iframe { pointer-events: none; }` ("the classic
split-pane bug") which the port does **not** have.

**Piece.** `registry/ui/split-panel/SplitPanel.pzl` **708 lines**, no lib deps, no npm deps.
Controlled/optional-controlled (`sizes` prop presence = controlled), callbacks `@resize`,
`@resizeEnd`. It re-implements upstream's measurement math nearly verbatim — `_panelExtra`,
`_constraintMeasure`, `_snapShare` are line-for-line translations of `#panelExtra` (`:257`),
`#parseConstraint` (`:250`), `#snapShare` (`:492`).

**The port's real bulk is Puzzle-reconciliation glue that a wrapper deletes outright.**
Roughly 80 lines exist only because sizes round-trip through `data()`: the committed+draft
overlay (`_applyDraft`, `_commit`, `_scheduleOverlayClear`), the `afterUpdate` microtask
dance with `_pendingClearCheck`, and the `_lastMeasure` / `_fallbackMeasure` pair that exists
solely so `--split-panel-visible` can be rendered as an inline style during prerender. A
wrapper needs none of it — the component writes those properties on nodes the template
doesn't style.

**The port also lost features the wrapper restores for free.** Its own header comment says:
"flat N-panel authoring (use nesting), opt-in animation controls (v1 always uses a subtle
settle), and px `size` authoring (sizes are normalized percent shares)" were "deliberately
dropped". Upstream has all three, plus per-divider `disabled`, plus the iframe fix.

**Size after conversion:** wrapper ≈ 90 lines. 708 → ~90, with a *larger* feature set.

**Main risk.** The API changes shape: named `slot="first"` / `slot="second"` becomes authored
`<split-panel>` children (34 `slot=` sites in `SplitPanelDoc.pzl`, 7 examples, 276 lines to
rewrite). Persistence keys on the element `id` upstream rather than a `storageKey` prop — a
rename, not a loss. The `defaultSizes={[35,65]}` prop becomes `size="35"` / `size="65"`
attributes on the panels.

**Upstream change needed only if N-panel authoring is exposed:** make `#createDividers()`
reuse an existing authored `<split-divider>` instead of removing and recreating it — the same
"create only if the template didn't already author it" pattern dialog-panel already uses for
`<dialog-backdrop>`. Not required for a two-pane wrapper.

**Downstream blast radius is small:** `magic-spells-puzzle-site` uses `<SplitPanel` only in
its ported docs page, nowhere in real app views.

---

### 3.3 `quantity-input` → `@magic-spells/quantity-input` — **KEEP PORT**

**Upstream.** `@magic-spells/quantity-input` 1.0.2, published, but effectively frozen (4
commits, last 2026-01-02). `src/quantity-input.js` **87 lines** + `src/quantity-input.css`
50 lines.

**The decisive fact: upstream does not render the control — the consumer does.**
`connectedCallback` (`quantity-input.js:29-37`) does
`querySelector('[data-action-decrement]')`, `querySelector('[data-action-increment]')`,
`querySelector('input')` and binds listeners to whatever it finds. A wrapper piece would
still have to author the two buttons, the SVG icons, and the input with all their Tailwind
token classes — i.e. **the entire body of the current 131-line piece stays**. The only thing
delegated is `#clamp` + `#handleStep` + `#handleInputChange`, about 25 lines.

**Wrapping would cost more than it saves.** Net: −25 lines of clamp math, +1 npm dependency,
+1 stylesheet import the piece would then have to *fight*, +new glue. Specifically:

- The stylesheet is the most opinionated in the survey relative to its size: 50 lines,
  **4 hex colors and 0 custom properties** — `border: 1px solid #ccc`, `background: #f8f9fa`,
  `button:hover { background: #e9ecef }`, fixed `width: 7rem; height: 2.5rem`. There is no
  theming hook at all. A token-styled piece would have to override every rule.
- `#syncInput()` (`:76-83`) does `Object.assign(input, {type, inputMode, pattern, value, min})`
   — an imperative **property** write to `input.value`, while the piece's template renders a
  `value` **attribute**. That is precisely the two-writers conflict the piece's controlled
  contract exists to avoid.
- It injects a global `<style>` into `document.head` (`:19-26`) purely to hide the
  webkit/moz number spinners — which the piece already expresses as Tailwind arbitrary
  variants (`[&::-webkit-inner-spin-button]:appearance-none`, `[-moz-appearance:textfield]`).
- It would touch `document` at construction time, which is hostile to prerender.

**Features the piece has that upstream lacks:** `step` (upstream is hard-wired to ±1),
`disabled`, `name`, `aria-label`, disabled-at-bounds button states, a `focus-within` ring on
the group, and NaN/empty-entry snap-back on commit. Upstream has nothing the piece lacks.

**Piece.** 131 lines, no deps, controlled (`value` in, `@change(next, event)` out), clamp
ported verbatim and cited as such in its header. 2 doc examples. Used for real in
`magic-spells-puzzle-site/app/views/examples/StorefrontDemo.pzl:110`.

This is the textbook "the piece's value is token-styled form-control markup" case from the
decision card. **Keep the port; no upstream change would change this verdict** short of
upstream generating its own themeable markup, which would make it a different component.

---

### 3.4 `dialog` → `@magic-spells/dialog-panel` — **WRAP LATER (M–L)**; `alert-dialog` → **KEEP PORT**

`@magic-spells/dialog-panel` 2.0.1, published, actively maintained (last commit 2026-08-01).
`src/dialog-panel.js` 669 lines + `src/dialog-panel.css` 287 lines. Light DOM. (Ignore
`/@magic-spells/dialog-panel-1.2.0/` — a stale non-git snapshot.)

Two facts make this the strongest *structural* wrap candidate after the two above:

- **Self-mutation is one node, and it is already pre-authorable.** The only `createElement`
  in the file is `<dialog-backdrop>` (`dialog-panel.js:64-65`), guarded by
  `if (!_.querySelector('dialog-backdrop'))` at `:63` — case 2 in §2, the proven pattern.
  Nothing else is created, removed, or reordered anywhere in the file. It uses a native
  `<dialog>` (required as a descendant, `:53`; missing → warn and early return, `:55-60`).
- **287 lines of CSS with 0 hex colors and 1 custom property** (`--dialog-backdrop-z-index`,
  `:104`) — essentially structural, at specificity `(0,0,2)` so Tailwind utilities win.

**What the wrapper would gain** (all absent from the port): a free body scroll lock via
`body:has(dialog-panel[state='showing']) { overflow:hidden }` (css `:251-255`); four drawer
position variants (css `:171-241`) against the piece's centered-only; `<dialog-backdrop>` as a
real element rather than `::backdrop`, which is what lets a morph blob fly *above* the scrim
(css `:33-47`); and a more complete native-force-close repair covering
`<form method="dialog">` and third-party `dialog.close()` (`:164-229`).

**What it would cost.** `Dialog.pzl` is 296 lines against 669 upstream, so this is a
"fixes flow for free" case, not a size win. Upstream has **no `observedAttributes` and no
`attributeChangedCallback`** — `open` cannot be a rendered attribute; the wrapper must call
`show()`/`hide()` imperatively from `afterUpdate()`. Upstream also has **zero
`prefers-reduced-motion` handling** (verified across its js and css), which the piece
implements itself (`Dialog.pzl:218`, `:232`), so the wrapper would have to keep doing that.
And the base rule `dialog-panel > dialog { opacity:0; transform:scale(.95) }` (css `:14-31`)
is exactly the stylesheet-opacity/transform-positioning that the piece's morph rule forbids —
upstream neutralizes it for morph mode at `:258-268`, but that interaction needs verifying
before conversion.

Events are good and uniform: `beforeShow`/`shown`/`beforeHide`/`hidden`, all
`bubbles + composed`, detail `{ triggerElement, result, state, … }` (`#emit`, `:552-569`),
with `beforeShow`/`beforeHide` cancelable and `data-result` plumbing at `:447`.

**`alert-dialog` is a separate, harder verdict — KEEP PORT.** `AlertDialog.pzl:36-44` requires
**Escape cancels, backdrop click inert**. Upstream's backdrop-click handler (`:129-141`) and
Escape handler (`:144-148`) are both unconditional with no attribute to disable either, and
**both call `_.hide()` with no argument** (`:138`, `:147`) — so `beforeHide.detail.triggerElement`
is `null` in both cases and **the two dismissal paths are indistinguishable in the event**.
There is no way to veto one and allow the other. Wrapping AlertDialog is impossible without an
upstream change (a `dismiss-policy` attribute, or a `reason` field in the `beforeHide` detail).
That is a small, worthwhile upstream addition — and it is the same shape as the dismiss policy
the `sheet` work is already dealing with, so raise it once for both.

**Verdict: WRAP LATER for `dialog`, KEEP PORT for `alert-dialog`.** Do `dialog` after `sheet`
lands and reuse whatever backdrop/dismissal conventions that conversion settles — `sheet` and
`bottom-sheet` both peer-depend on `dialog-panel`, so all of them should share one wrapped
overlay story rather than being converted independently.

### 3.5 `bottom-sheet` → `@magic-spells/bottom-sheet` — **WRAP LATER (L), and reconsider the piece**

`@magic-spells/bottom-sheet` 2.0.2, published, active (2026-08-02). 1015 + 196 + 81 = 1292
JS lines + 302 CSS (1 hex, 20 custom properties). Peer dep on
`@magic-spells/dialog-panel >=2.0.0 <3`, dependency on `@magic-spells/physics-engine`.

**Structurally this is the safest component in the entire survey**: grep for
`createElement|innerHTML|appendChild|remove()|cloneNode` over `src/` returns **zero hits**.
`connectedCallback():497-537` only queries, attaches `DragGesture` instances, and binds
listeners; all runtime mutation is attributes/classes/inline styles on the *ancestor*
`<dialog>` and `<dialog-panel>` (`dialog.style.height = …dvh` `:959`, `setAttribute('snap',…)`
`:966`). Case 1 in §2.

But three things pull against it. **(a)** The stylesheet is genuinely opinionated and reaches
*upward*: `dialog-panel:has(bottom-sheet) > dialog { background: var(--bs-panel-background) }`
(css `:51-52`, defaulting to white) and the same for the backdrop (`:203-208`). It owns the
sheet's whole presentation, where the piece uses Tailwind tokens with a real dark mode
(`PANEL_BASE:167` `bg-surface`). **(b)** Consumer markup is rigid and three levels deep —
`<dialog-panel><dialog><bottom-sheet><bottom-sheet-header>…` (documented `:28-36`; gesture
surfaces located by `querySelector` at `:332-348`). **(c)** It re-adds the `dialog-panel`
peer dependency that the piece deliberately dropped — `BottomSheet.pzl` uses a self-contained
native `<dialog>` with an in-dialog backdrop div (`:8-15`).

Sizes are near parity (1123 + 180 vs 1292 + 302), so this is a "fixes flow for free" case, not
a size win. Upstream would contribute `max-display-width` (auto-suppress above a breakpoint,
`:88-96`), the `--bs-backdrop-progress` token the piece explicitly dropped (`:102-105`), and
dialog-panel's cancelable `beforeShow`/`beforeHide`.

**The real question is whether the piece should survive at all.** The registry ships both
`bottom-sheet` and `sheet` (`demo/app/docs/nav.js:86` and `:104`), and `sheet`'s own
description is "a snap-point bottom sheet on phones [that] morphs … into a side drawer or
centered dialog" — a superset. Once `sheet` is a wrapper, `bottom-sheet` is a second,
hand-maintained implementation of its phone case. **Defer this pair entirely until the sheet
conversion lands**, then decide between (a) wrapping `@magic-spells/bottom-sheet`, or
(b) retiring the `bottom-sheet` piece in favour of `Sheet`. Do not convert it in parallel.

### 3.6 `marquee` → `@magic-spells/scrolling-content` — **WRAP LATER (M)**

`@magic-spells/scrolling-content` 2.0.0, published, active (2026-08-10). `src/scrolling-content.js`
476 lines + 67 CSS. Zero dependencies.

**My first read of this pair was wrong and the correction matters.** `#buildDOM()` is
**guarded, adopt-if-present**, not destructive:

```
:221  _.#track = _.querySelector('scrolling-track');
:222  if (!_.#track) { create <scrolling-track>; move children into it; append }
:228  if (!_.#track.querySelector('scrolling-item')) { create <scrolling-item>; move; append }
```

If the wrapper template pre-authors `<scrolling-track><scrolling-item>…`, **nothing is created
and nothing is re-parented** — case 2 in §2, not case 4. That makes this materially more
wrappable than it first appears.

Three further points in its favour:

- **The stylesheet is purely structural** — 67 lines, zero backgrounds/fonts/borders/theme
  colors; the only 4 hex values are `#000` mask-gradient stops (`:21-22`, `:28-29`).
- **No stylesheet import step for the consumer.** The CSS self-injects at module scope
  (`scrolling-content.js:464`) into a `@layer scrolling-content` (`:13-16`), and it is inlined
  into `dist/…esm.js`. That removes one of the two documented consumer costs.
- **The port has the same clone problem and solves it the same way.** `Marquee.pzl:147-152`
  says outright: "A parent re-render recreates the slot content and drops the clones + the
  inline transform we wrote imperatively — rebuild, then resume." Upstream's public
  `refresh()` (`:156-167`) plus `#fill()` re-reading `#items` (`:306`) is the identical
  mitigation. Porting did **not** avoid the hazard; it just re-implemented the workaround.

**So why still LATER, not NOW?** Two concrete gaps and one exposure risk:

1. **Vertical direction does not exist upstream.** `Marquee.pzl` supports `up`/`down`
   (`:110-123`, with a `touch-action` flip at `:132`); `scrolling-content`'s `direction` is
   horizontal-only. Wrapping today is a straight feature regression. Needs an upstream
   addition first.
2. **`scrolling-content:not(:defined) { visibility: hidden }` (css `:3`)** — the same
   prerender hazard as panel-stack (§3.1). On static output the ticker is invisible until the
   dynamic import lands.
3. **Highest real-world exposure of any piece here.** `magic-spells-puzzle-site` uses
   `<Marquee` in **six** views (`Home2`, `OpenSourcery`, `landings/Puzzle`,
   `landings/PuzzlePieces`, `PieceField`, `StorefrontDemo`), plus 5 doc examples.

**What the wrapper would gain:** the `fade` edge-mask attribute and `--scrolling-content-fade`
(css `:16-32`), a `paused` attribute with `start()`/`stop()`, four lifecycle events
(`scrolling-content:start|stop|drag-start|drag-end`), and a `--scrolling-content-speed`
custom property that lets a media query retune speed per breakpoint (`#resolveSpeed():269-276`)
— none of which the piece has.

**Upstream changes needed first:** vertical direction, and the `:not(:defined)` rule. Both
small. After those this becomes a clean WRAP NOW, and it is the best candidate in the
second wave.

### 3.7 `tabs` → `@magic-spells/tab-group` — **KEEP PORT**

`@magic-spells/tab-group` 1.1.0, published but stale (last commit 2026-03-17). 381 JS + 19
CSS lines. **The port is nearly half the size of the component** (200 vs 381) — the size
argument runs backwards before anything else is considered.

Its stylesheet is the *best* in the survey — 19 lines, 0 hex, 0 custom properties, 100%
structural, and the README says so explicitly ("No fonts, colors, spacing, borders,
transitions, shadows, or media queries"). It would not fight Tailwind tokens at all. And its
three node creations (`tab-group.js:33`, `:38`, `:48`, including
`newPanel.innerHTML = '<p>default panel content</p>'` at `:49`) are all *guarded* and avoidable
by pre-authoring `<tab-list>` and matching counts.

**It fails on four other things, any one of which is disqualifying:**

1. **Static snapshot with no re-scan.** `tabButtons`/`tabPanels` are captured once at `:72-77`;
   there is **no `MutationObserver`, no `observedAttributes`, no public re-init**. A
   `{#for}`-driven tab list that changes length leaves the arrays stale — new buttons get no
   `role`/`id`/`aria-*`, and clicking one falls out at `onClick:304` (`indexOf === -1 → return`).
   Dynamic `tabs` arrays are `Tabs.pzl`'s entire API (`:93-96`). Worse, any render that
   momentarily produces unequal button/panel counts **injects the placeholder junk above**, and
   the patcher will never remove it.
2. **Unconditional id clobbering → permanent desync.** `:85` and `:102` overwrite author ids
   (unlike collapsible's guarded `||=`). The template must declare `id` for the piece's
   panel-wiring convention (`Tabs.pzl:9`), so `patchAttrs` re-asserts the template id on the
   next patch while `aria-controls` (`:87`) is never recomputed.
3. **`tab.focus()` at `:231`, unconditional on every `setActiveTab`.** Any wrapper reasserting
   `props.value` in `afterUpdate` would steal focus on every parent re-render.
4. **Accessibility regressions.** `<tab-button>` is `class TabButton extends HTMLElement {}`
   (`:363`) with `onKeyDown` ending in `default: return` (`:346-347`) — **Enter/Space do not
   activate a tab**, where `Tabs.pzl` uses a real `<button type="button">`. Upstream also has
   **no `disabled` concept at all**, where the piece skips disabled tabs in roving nav
   (`:129`, `:137`, `:139`), and no way to set the initial tab (hardcoded first, `:90`, `:107`).

`Tabs.pzl`'s design — render the tablist only, panels stay parent-owned, wired by an id
convention (`:32-51`) — is fundamentally incompatible with a component that manufactures and
`innerHTML`s panels. Keep the port. (Upstream's animated panel transitions with `animationend`
+ timeout fallback and `AbortController` cancellation of rapid clicks, `:139-202`, are a nice
idea to port *into* the piece someday.)

### 3.8 `collapsible` / `accordion` → `@magic-spells/collapsible-content` — **KEEP PORT**

1.1.1, published, stale (2026-03-16). 301 JS + 31 CSS (0 hex, 2 custom properties).

**This is the safest component in the review on the DOM axis** — grep for
`createElement|innerHTML|appendChild|insertBefore|remove()` across its source returns **zero
matches**; it creates, reorders and removes nothing, and several of its attribute writes are
politely guarded (`button.id ||=` `:81`, `content.id ||=` `:82`, `role="region"` `:90-92`).

It is nonetheless a clear KEEP PORT, for three independent reasons:

1. **There is no toggle event.** Its only event is `collapsible-error` on a markup failure
   (`:71-77`). The component's own click handler flips `content.collapsed` (`:47-52`) and
   tells nobody. `Collapsible.pzl` is controlled — `data():81` reads `!!props.open`, `toggle`
   never mutates local state, and it emits `@change(open, event)`. **That contract cannot be
   built over a component that reports nothing** without a `MutationObserver` on
   `aria-expanded`. (§2, fourth constraint.)
2. **The arithmetic runs backwards.** `Collapsible.pzl` is **187 lines against 301 upstream**,
   with zero dependencies and zero lib files. Wrapping increases total consumer cost (npm dep
   + stylesheet import + wrapper) for a component that has not moved in five months.
3. **The piece uses the Web Animations API** (`:152-155`, `:169-172`) where upstream uses a
   CSS `height` transition gated on `getComputedStyle(_).transitionDuration !== '0s'`
   (`:245`) — so upstream's animation **silently dies if the stylesheet is missing**, and it
   needs a `transitionend` round-trip. The piece has neither dependency.

Two further upstream limits worth noting if this is ever revisited: the group registry is
**module-global keyed by group-name string** (`:11-26`) with no subtree scoping, so two
unrelated accordions both using `group="faq"` would close each other's panels; and it has
**single-open only** — `Accordion.pzl`'s `type="multiple"` has no upstream equivalent. The
button reset `collapsible-component button { background:none; border:none; … }` (css `:5-11`)
also applies to every `<button>` a consumer puts inside panel content.

**Doc bug found in passing (worth fixing regardless of this assessment):**
`Collapsible.pzl:50-51` claims "NO Accordion component ships — exclusive-open is a parent
pattern." An Accordion piece *does* ship (`registry/ui/accordion/Accordion.pzl`, indexed at
`registry/registry.json:28-36`). Stale comment. Separately, `Accordion.pzl` duplicates
Collapsible's animation code inline (`:160-216` mirrors `Collapsible.pzl:123-178`) rather than
depending on the piece — a real de-duplication opportunity, and note `Accordion.pzl:28` renders
`{ row.content }` as an interpolation, so item content is **plain text only** (documented
`:62-69`).

### 3.9 `popover` / `dropdown-menu` / `hover-card` → `@magic-spells/dropdown-panel` — **KEEP PORT**

1.0.0, published, stale (last commit 2026-02-27). Total source **216 JS lines** (154 + 39 +
23) + 83 CSS (0 hex, 0 custom properties — its own header says it ships "ONLY the styles
required for functionality").

On the DOM axis it ties collapsible-content for safest: grep for
`createElement|innerHTML|appendChild|insertBefore|remove()` across all of `src/` returns
**zero matches**. But it fails on both of §2's other constraints at once:

- **No `observedAttributes`, no `attributeChangedCallback`.** State lives in
  `panel[aria-hidden]` (`:124`, `:133`, `:145`); the only handles are `toggle()`/`show()`/`hide()`.
- **No events of any kind** (verified: zero `dispatchEvent`/`CustomEvent` in the package).
  All three pieces expose `@show`/`@hide` (`Popover.pzl:141-142`, `DropdownMenu.pzl:179-180`,
  `HoverCard.pzl:210-211`). Reproducing those requires a `MutationObserver` on `aria-expanded`.

And the feature gap runs the wrong way. The three pieces total 835 lines and carry:
**auto-flip placement measurement** (`Popover._measurePlacement:173-184`, `HoverCard:262-273`)
— upstream does **zero** measurement, it is `top:100%; left:0`, full stop; **real `<button>`
triggers** with native Enter/Space, where upstream's `<dropdown-trigger>` is a div-alike with
`role="button"` and hand-rolled key handling (`dropdown-trigger.js:32-34`);
**DropdownMenu's entire item model** — dividers/groups/danger/disabled/href, roving focus,
Home/End, wrap-around skip-disabled (`:119-133`, `:213-225`, `:303-310`), where upstream does
neither roving tabindex nor `aria-activedescendant`; and **HoverCard's 600ms/300ms open/close
delays** (`:126-134`), where upstream opens and closes immediately on
`pointerenter`/`pointerleave` (`:54-59`).

**HoverCard has a hard blocker specifically:** it is optional-controlled (`_controlled():114-116`),
and upstream's `pointerenter → show()` (`:55`) is unconditional with no interception hook. A
controlled parent would watch the panel open itself and then get closed back — a flicker with
no fix.

A wrapper would be the current port **plus** MutationObserver glue, minus the real button and
the auto-flip, wrapped around a component contributing only `toggle()`. Squarely the decision
card's own exit condition. Keep the port.

One upstream idea worth *stealing* rather than wrapping: the **CSS hover bridge** (css
`:17-46`) — an invisible perspective-skewed wedge under the trigger that keeps hover alive
across the gap to the panel. All three pieces lack it, and HoverCard compensates with a 300ms
close delay instead. Also missing from the pieces: touch discrimination
(`if (e.pointerType !== 'touch')`, `:55`, `:58`).

### 3.10 `select` / `combobox` / `multi-select` → `select-dropdown` + `dropdown-select` — **KEEP PORT**

**Which upstream is even the right one took real digging.** `dropdown-select` is gen 1 (npm
0.3.0, four releases, last commit 2025-09-24 — nearly a year stale; 565 JS + 150 CSS).
`select-dropdown` is gen 2: first commit 2026-03-08 17:30, about an hour after gen 1's last
touch, sharing identical `--select-color-*` variable names and README structure. It is a
renamed feature-superset rewrite (adds `select-divider`/`select-label`, a `value` getter/setter,
form-reset restore, multi-char typeahead, `select-dropdown:show/hide` events, and a **live**
`#options` getter `:34-36` where gen 1 caches a **static NodeList** `:43` that breaks outright
on a dynamic list). The port already encodes this judgement — `Select.pzl:98-99` says "ported
from the **select-dropdown** web component (**gen 2**)".

**But gen 2 is not safely dependable today, on two counts:**

1. **npm has only 0.1.0**; local is 0.2.0 and unpublished.
2. **The working tree is not what's published.** It sits on branch `experiment/morph-engine`
   whose HEAD equals `main`'s, so the entire MorphEngine rewrite is **uncommitted** (677 local
   lines vs 595 committed). Worse, working-tree `select-dropdown.js:2` imports
   `'../../../morph-engine/src/index.js'` — **a relative path outside the repo**, not a package
   dependency — and rollup inlines it, ballooning `dist/select-dropdown.esm.js` to 88 KB / 2814
   lines while `README.md:3` still advertises "~3.5 KB gzipped · Zero dependencies".

Beyond dependability, the substance:

- **Both stylesheets are opinionated and leak.** `select-dropdown.css:2-13` declares a hex
  palette on **global `:root`**; `:20-32` pins `width: 300px`, a `margin-bottom: 1rem` and an
  `-apple-system` font stack on the element; `:15-17` installs a **document-wide scroll lock**
  (`body:has(select-dropdown[visible]) { overflow: hidden }`). Neither has any dark-mode story.
- **Neither can be driven by attributes** (§2) — gen 1 declares `observedAttributes = ['position']`
  **with no `attributeChangedCallback`, so the observed attribute does nothing** (`:20-22`);
  gen 2 declares none. Gen 2's `change` event is a plain `Event` with **no detail** (`:510`).
- **Neither supports per-option `disabled`.** `Select.pzl` normalizes a config-first `options`
  array with `{value,label,disabled}`/`{group}`/`{divider}` in `data():216-268` and drives
  keyboard nav with `aria-activedescendant` (`:58`, `:284`), where upstream calls
  `options[i].focus()` (`:486`) — which would fight the patcher.
- **Both write into nodes a template owns**: `#label.textContent` (`select-dropdown.js:206`,
  `:221`) and `selected`/`aria-selected`/`tabindex`/`id` on per-option elements a `{#for}`
  would own (`:195-198`, `:288-293`).

**`Combobox` and `MultiSelect` have no upstream counterpart at all** — in either package. Only
`Select` maps onto anything, so two of the three pieces are not even candidates.

Keep the port. Prerequisites if ever revisited: upstream consolidates on gen 2, commits the
morph work with a real package dependency, publishes it, and adds per-option `disabled`.

### 3.11 `slider` → `@magic-spells/range-slider` — **KEEP PORT**

**Not publishable, and not even a git repository** — `git -C range-slider log` fails
(no commits), and `npm view @magic-spells/range-slider version` 404s. A
`piece.json.dependencies` entry cannot resolve. That alone is dispositive.

Independently it is case 5, and **destructively so — this is the one component with no
adopt-if-present branch at all.** `#render():310-324` opens with
`_.querySelector(':scope > slider-rail')?.remove()` (`:310`) and
`_.querySelectorAll(':scope > input[data-generated]').forEach(el => el.remove())` (`:311`),
then rebuilds `<slider-rail>`/`<slider-track>`/`<slider-fill>`/`<slider-ticks>` and N
`<slider-thumb>` and `prepend`s the lot (`:313-324`). `#renderTicks():354` does
`container.innerHTML = ''`. `#rerender():337-347` re-runs the whole thing whenever
single/range mode flips. A pre-authored rail is deleted, not reused.

`Slider.pzl` (842 + `lib/slider-math.js` 214) is a token-styled form control — the decision
card's named port exception — with 8 doc examples and real use in three puzzle-site views. It
also carries a materially richer tick model than upstream (`true | number[] | {value,label,class}[]`
with auto-coarsening and label thinning, `Slider.pzl:160-193`) and `aria-valuetext` on every
thumb at five sites, where upstream has **none** (only `aria-valuenow`, `range-slider.js:601`).
Keep the port.

### 3.12 `toast` → `@magic-spells/notification-stack` — **KEEP PORT**

**Unpublished and not a git repository** (no commits; `npm view` 404s). Dispositive on its own.

Also case 5: `NotificationCard.create():64-105` generates every card —
`createElement('notification-card')`, an icon span with `innerHTML = ICONS[variant]`, title and
message divs, a dismiss button with `innerHTML = DISMISS_ICON`, a progress div.

**And there is a subtler hazard worth recording for future reference.** Author-rendered cards
*are* adopted (`#adoptCard():275-280`), which looks safe — but they are then subject to
**removal**: `dismiss()` accepts any `:scope > notification-card` (`:172-176`) and
`#reflow():333-335` auto-dismisses everything past `max-visible` with reason `'overflow'`. A
template-rendered card list would be silently deleted out from under the patcher. **"Adopts
your children" is not sufficient for wrap-safety — the component must also never remove
them.** That is a sixth case to add to §2.

The stylesheet is opinionated (335 lines, 51 custom properties, 6 hex — it paints the card:
`background: var(--ns-card-background)` `:137`, `font-weight: 600` on titles `:236`). The
piece is an imperative `toast()` module singleton over a 140-line `Toaster.pzl` host, used in
both puzzle-site layouts (`AppShell`, `DocsLayout`). Its pausable `DismissTimer` is already
ported near-verbatim from `src/utils/dismiss-timer.js`. Keep the port.

### 3.13 `date-picker` / `calendar` / `date-range-picker` → `@magic-spells/date-picker` — **KEEP PORT**

**Unpublished (`npm view` 404s), one commit, dated 2026-07-18.** Dispositive on its own.
1983 JS + 464 CSS.

Worth recording that the DOM story here is *better* than case 5 suggests: every generation
site is guarded (`#ensureTriggerButton:619-629`, `#ensurePanelInternals:633-649`, the 42-cell
grid at `:652-683`), and re-render never rebuilds — `#render():1060-1105` repaints the same
persistent cells via `textContent`/`dataset`/`aria-*`. So if it were published, it would not
be disqualified on reconciliation grounds.

It is disqualified on the other two axes instead, and both are the decision card's stated port
exception:

- **Theming.** 464 CSS lines, 22 custom properties, 8 `:root` hex defaults, **and no
  `prefers-color-scheme` block anywhere — it is light-only.** The registry's whole premise is
  semantic tokens with a working dark mode.
- **The pieces' value is exactly the markup a wrapper hands back.** `disabledDates` as an array
  *or a predicate* (`Calendar.pzl:340-354`) does not exist upstream at all (zero hits across
  `src/` and README); nor does the range-presets rail (`DateRangePicker.pzl:310-322`), nor
  two-month side-by-side grids, nor the field chrome with wired `aria-invalid` /
  `aria-describedby` (`DatePicker.pzl:65-69`).

One clean finding: `registry/lib/date-math.js` (234 lines, 16 exports) is a **byte-identical
subset** of upstream's `src/utils/date-math.js` (303 lines, 21 exports) — `diff -u` shows no
divergence in shared code, just five unused functions dropped and a provenance comment added.
That is the half-fork pattern working as intended, and it is the right shape to keep here.

Known piece regression to log: `DateRangePicker.pzl:188-194` — with `months={2}` the two grids
navigate independently, because Calendar owns its month internally and exposes no month-anchor
prop. Upstream's single `#viewYear`/`#viewMonth` (`:63-64`) has no such issue. Fix in the piece,
not by wrapping. Keep the port.

### 3.14 `carousel` → `tarot` — **KEEP PORT**

`/Users/coryschulz/Code/@magic-spells/tarot` is a monorepo (`@magic-spells/tarot-monorepo`
0.0.0). **`@magic-spells/tarot`, `tarot-puzzle`, `tarot-effects` and `tarot-ripple` are all
unpublished (404).** `tarot-effects` is marked `"private": true` — "Sold separately — not
published to npm". Nothing to depend on; dispositive.

Structurally it would also be the worst case in the survey. `slide-manager.js:134-143`
`wrapSlide()` does `parent.replaceChild(wrapper, element)` on every unwrapped track child;
`tarot.js:492-494` moves every viewport child into a generated `<tarot-track>`; and the button
and pagination plugins inject chrome **unconditionally** —
`buttons.js:67-77` `insertAdjacentHTML('afterbegin', …)` (with `showButtons:false` merely
setting `display:none` afterwards, `:222-235`) and `pagination.js:130` doing
`container.innerHTML = ''`.

**The important finding is that this problem is already solved upstream, in a different
place.** `packages/tarot-puzzle/src/TarotCarousel.js` is a working Puzzle binding that
pre-authors the exact tree tarot would otherwise generate (`:222-239`) so nothing gets
rewrapped, and requires keyed `<tarot-slide>` children (`:52-56`). **If a full-featured
carousel is ever wanted in Puzzle, that package is the answer — not a registry wrapper
piece.** (It has one live bug worth reporting: `:168-169` forwards
`carousel:before-transition` / `carousel:after-transition`, neither of which exists in
`core/events.js` — dead wires.)

Meanwhile `Carousel.pzl` (459 lines, zero deps) is a deliberately much smaller thing: native
scroll + CSS scroll-snap, arrows, dots, keyboard, autoplay, optional-controlled index with
`@change`. It creates and moves **no nodes at all** (`_slides()` is
`Array.from(track.children)`, `:251-254`). It is not competing with tarot and should not try
to. Keep the port.

### 3.15 Upstream repos with no corresponding piece

Verified by searching all 95 pieces in `registry/ui/` and `registry.json`: grep for these five
names across the whole registry returns exactly one hit, and it is unrelated (the word
"focus-trapping" in a comment at `registry/ui/popconfirm/Popconfirm.pzl:52`). No piece covers
any of them under an alternate name either — `progress`/`progress-ring` are value gauges, and
`scroll-area`/`scroll-stack` are unrelated to `scroll-progress`. **All five are new-piece
opportunities, not conversions.**

| Upstream | Published | Size | Note |
|---|---|---|---|
| `image-zoom` 0.1.0 | **yes** | 823 JS + 62 CSS (1 hex, 7 custom props) | **No piece.** Light DOM, **no `createElement` in `src/` at all**, rich event API (`image-zoom:change`, `:zoomstart`, `:zoomend`). Pinch-to-zoom/pan for images. **The strongest new-wrapper-piece candidate in the ecosystem** — published, safe, and there is nothing to port. |
| `scroll-progress` 1.1.0 | **yes** | 502 JS, no CSS | **No piece.** Emits `scroll-progress:velocity` and `:update`. A pure behaviour broadcaster — the same shape as scroll-stack, which is the case wrapping suits best. Good second candidate. |
| `load-content` 0.2.0 | yes | 253 JS | **No piece.** Fetch-and-inject with pagination; overlaps Puzzle's own routing and data layer. No piece needed. |
| `focus-trap` 1.0.7 | yes | 198 JS | **No piece.** A utility, not UI — `Dialog`/`AlertDialog` trap inline. Not a registry shape. |
| `color-picker` (unpublished) | **no** | 1015 JS + 342 CSS (14 hex, 21 custom props) | **No piece**, not published, not a git repo. Generates its whole panel via `createElement`/`innerHTML` (`color-picker.js:328-360`). Not a candidate. |

Also checked and confirmed to have no registry counterpart: `cart-item`, `cart-panel`,
`cart-progress-bar`, `gift-with-purchase`, `account`, `api` (Shopify-domain);
`responsive-video`, `split-text`, `colored-text` (effects); `scroll-trigger`,
`scroll-velocity`, `animation-engine`, `timeline-engine`, `frame-engine`, `physics-engine`,
`morph-engine`, `desktop-swipe-engine`, `event-emitter` (engines, already consumed as npm
`dependencies` where relevant); `theme-support`.

---

## 4. Recommended order of conversions

1. **`panel-stack`** — first, but only after the two one-line upstream CSS fixes
   (`background: blue` at `panel-stack.css:84`, and the `:not(:defined) { visibility: hidden }`
   rule at `:2-4`). It is the only candidate with *zero* light-DOM mutation, so it validates
   the wrap pattern for a component that drives slotted children — the next step beyond what
   ScrollStack proved. Deletes `registry/lib/panel-stack.js` outright. Ship the upstream
   patch and republish 0.1.1 before touching the piece.
2. **`split-panel`** — second, no upstream change required if the wrapper keeps the two-pane
   slot shape. Biggest single line-count win in the registry (708 → ~90) and it *restores*
   N-panel support, px sizes, per-divider disable and the iframe drag fix. Also the pair with
   the smallest downstream blast radius (docs page only).
3. **`scrolling-content` → `marquee`** — third, after two small upstream additions (vertical
   direction; drop the `:not(:defined)` visibility rule). Structurally it is already fine
   (adopt-if-present `#buildDOM`), it needs **no stylesheet import** because the CSS
   self-injects, and the port is already re-implementing upstream's clone workaround by hand.
   Sequence it after (1) and (2) only because it has the widest real-world exposure — six
   puzzle-site views.
4. **`dialog-panel` → `dialog`** (not `alert-dialog`) — after `sheet` lands, sharing its
   backdrop/dismissal conventions. `sheet` and `bottom-sheet` both peer-depend on
   `dialog-panel`, so converting them piecemeal would fragment the overlay story. Bundle the
   `alert-dialog` dismiss-policy request (§3.4) into the same upstream conversation.
5. **`bottom-sheet`** — last, and start by deciding whether the piece should be **retired** in
   favour of the wrapped `Sheet` rather than converted. It is the safest component on the DOM
   axis but the most opinionated on styling, and it re-adds a `dialog-panel` peer the piece
   deliberately dropped.

Everything else stays a port.

### Separately: two new wrapper pieces worth more than any conversion

`image-zoom` (published 0.1.0, 823 lines, creates no nodes, rich event API) and
`scroll-progress` (published 1.1.0, 502 lines, pure broadcaster) have **no piece at all**.
Wrapping either is greenfield — no API migration, no doc rewrite, no downstream breakage, and
nothing to port. Measured in value per hour of work they beat every conversion on this list
except `panel-stack`, and they exercise the wrap pattern on exactly the component shape it
suits best. Worth scheduling ahead of items 3–5.

### Cross-cutting follow-ups

- **Add §2 to [[DECISION-WRAP-WEB-COMPONENTS]].** The card currently states the attribute half
  of the reconciliation story. Three things belong alongside it: the sibling-node rule
  (`viewManager.js:1169` + `:1188-1192`), the **attribute-drivability** table (most of these
  components have no usable `observedAttributes`, which disqualifies more candidates than size
  does), and the **"adopts your children is not enough — it must also never remove them"**
  case that notification-stack demonstrates (`#reflow():333-335` auto-dismisses past
  `max-visible`).
- **Read `tarot-puzzle/docs/PUZZLE-FRICTION.md` before the first conversion.** It is an
  existing, independently-derived audit of exactly this problem, from a team member who already
  shipped a working Puzzle binding over a hostile component.
- **A "reuse if pre-authored" convention for upstream components.** dialog-panel already does
  it for `<dialog-backdrop>`. split-panel (`#createDividers`) and scrolling-content
  (`<scrolling-track>`) need the same treatment, and it would unblock both. Worth making it a
  stated rule in the `web-components` skill rather than a per-component fix.
- **Wrapper pieces need a published-package smoke test.** `demo/package.json` points
  `@magic-spells/scroll-stack` at `file:../../scroll-stack`, so `npm run build` in `demo/`
  passes against the local checkout, not the tarball a consumer gets. `select-dropdown`
  (local 0.2.0 vs npm 0.1.0) shows how easily those diverge.
- **Every conversion touches eight places:** the `registry/ui/<name>/` file(s), its
  `piece.json` (`dependencies` gains the package), `registry/registry.json`, the
  `demo/app/components/ui/` copy, the `*Doc.pzl` page, `demo/app/docs/nav.js` description
  (the scroll-stack entry's "wraps the … web component rather than porting it" phrasing is
  the precedent), `demo/app/styles/styles.css` (`@import "…/css" layer(components);`), and
  `demo/package.json`. No `test/` suites cover `panel-stack`, `split-panel` or
  `quantity-input`, so those three carry no test-porting cost.
- **Wrapping moves pieces off zero-dependency.** Eight of the eleven pieces surveyed currently
  declare `dependencies: []`; only `dialog` and `select` already carry an npm dep
  (`morph-engine`). That is a real change in the registry's character and worth being
  deliberate about.

### Incidental bugs found while surveying (independent of any conversion)

These are worth fixing regardless of whether anything is ever wrapped:

1. **`panel-stack/src/panel-stack.css:84` — `background: blue`**, shipping in the published
   tarball as `background: #00f`. A debug leftover on every `<stack-panel>`.
2. **`Collapsible.pzl:50-51`** claims "NO Accordion component ships". One does
   (`registry/ui/accordion/Accordion.pzl`, `registry.json:28-36`). Stale comment.
3. **`Accordion.pzl:160-216` duplicates `Collapsible.pzl:123-178`** verbatim instead of
   depending on the `collapsible` piece — a live de-duplication opportunity.
4. **`DateRangePicker.pzl:188-194`** — with `months={2}` the two grids navigate independently,
   because `Calendar` owns its month internally and exposes no month-anchor prop. Already
   documented in the piece as a known limitation; fixable in the piece.
5. **`tarot-puzzle/src/TarotCarousel.js:168-169`** forwards `carousel:before-transition` and
   `carousel:after-transition`, neither of which exists in `core/events.js`. Dead wires.
6. **`select-dropdown` is in a broken working state** — uncommitted MorphEngine rewrite on
   `experiment/morph-engine`, importing `'../../../morph-engine/src/index.js'` (a path outside
   the repo) which rollup inlines into an 88 KB bundle, while the README still advertises
   "~3.5 KB gzipped · Zero dependencies".
7. **`dropdown-select/src/components/dropdown-select.js:20-22`** declares
   `observedAttributes = ['position']` with no `attributeChangedCallback` anywhere — the
   observed attribute does nothing.
