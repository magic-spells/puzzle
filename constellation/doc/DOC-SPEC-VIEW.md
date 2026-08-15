---
name: SPEC — view runtime, lifecycle, and animation
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ANIMATIONS
verified_at: '2026-08-14T05:01:28.752Z'
verified_sha: d74916a0e021b6bb86394551171838fbab161347
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
  - kind: verified
    text: >-
      §60 added: the app-level onError + errorView contract (v1.67/v1.71, from D145).
    sha: d74916a0e021b6bb86394551171838fbab161347
---

The frozen v1 contract for the view runtime: animations, skeleton loading, `this.memo()`, app lifecycle hooks, cross-view morphs, element refs, scroll-triggered enters, and the `flip` directive. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 12. Animations (v1.1)

Declarative enter/leave animations on views, layouts, and reusable components, driven by the Web Animations API. Shipped in v1.1 (D28); the `animations` class field is no longer inert.

**Field shape.** An optional `animations` class field with optional `in` and `out` keys:

```js
animations = {
  in:  { from, to, duration, easing?, delay? },
  out: { from, to, duration, easing?, delay? },
};
```

Each spec compiles to `el.animate([from, to], { duration, easing, delay, fill: 'both' })`. `from`/`to` are WAAPI keyframe objects; `duration`/`delay` are milliseconds; `easing` is any CSS easing string. Either key may be omitted (that phase then runs instantly). A malformed spec **warns once and is skipped** — it never breaks rendering. *(Amended in v1.40: an `in` spec may also carry `trigger: 'visible'` + `triggerOffset` to defer the enter until the element scrolls into view — §39, D73.)*

**Animation target.** The instance's own root element — for views and layouts the `<puzzle-view>` element; for reusable components the single root element the template requires (D20). There is **no wrapper element**; the single-root rule makes the root the animation handle.

**Out animations in lists require keys.** The keyed reconciler patches around a leaving element (`leavingEls`); the indexed (unkeyed) path has no leaver awareness, so survivors can visibly misorder while an unkeyed sibling fades out. Supported pattern: key the list items. Development builds warn once per session when an unkeyed list unmounts an out-animated component.

**Completion.** Detected via the WAAPI `Animation.finished` promise. Interrupting navigation or unmount **cancels** the running animation and proceeds immediately.

**Lifecycle hooks.** Four no-op base methods on `PuzzleView`, firing around each phase:

- Show path: `viewWillShow()` → `in` animation → `viewDidShow()`.
- Hide path: `viewWillHide()` → `out` animation → `viewDidHide()`.

Hooks are lifecycle, not animation callbacks — **they fire in order even when no `animations` field is declared** (zero-duration semantics). They compose with the existing hooks: `mounted()` precedes `viewWillShow()`; `viewDidHide()` precedes `destroyed()`. *(Amended, D118: a throwing `destroyed()` is caught and logged — the surrounding teardown cascade (parent destroys, `Router.stop()`, `PuzzleApp.unmount()`) always completes; the last unguarded user hook on the teardown path could previously strand the app half-torn-down with `_mounted` still true.)* *(Amended, D136: the order holds for anchor-race superseded async mounts too — an enter requested while the first render is still pending defers and replays after `mounted()` on the real root, instead of firing the show hooks against the comment anchor before `mounted()` and losing the enter animation. And a LEAVING view is inert from `playOut()` start: store subscription dropped immediately, `refresh`/`setData`/store-change/parent-update deliveries ignored — the fading element no longer re-renders mid-leave.)*

**View transitions are sequential in v1.1.** After the new view's `data()` resolves (the D19 gate), the old view plays `out` and is destroyed; then — in one synchronous block, atomically with the new view mounting (§30, D61) — the URL and title commit and the new view plays `in`. A navigation superseded or failed while the old view is animating out commits nothing. The enter animation is **non-blocking** (fire-and-forget) — navigation is not held open waiting for it. Cross-fade / overlapping transitions are deferred (they need a positioning strategy). *(Amended: overlap shipped in v1.24, §26; the location-commit placement moved in v1.28, §30 — v1.1–v1.27 committed URL/title before the out animation.)*

**One animator per transition.** A routed view swapped inside a **reused** layout animates alone (the layout does not animate). On a **layout swap**, the layout animates as the unit and its view rides along — no double animation.

**Enter animations release on finish.** After an `in` animation's `finished` resolves, its filled styles are cleared so the element sits in its natural styled state. Therefore the `to` keyframe **must equal the element's natural resting style** — otherwise a visible snap occurs at release.

**Reduced motion.** When `matchMedia('(prefers-reduced-motion: reduce)')` matches, all durations are zeroed; hooks still fire in order.

**Height animations need explicit pixel values.** WAAPI cannot animate to `height: auto`. Collapse/expand effects must animate between explicit `px` values (the shipped pattern wraps the row's content in a fixed-height inner element — see USER_GUIDE).

## 16. Skeleton loading (v1.8)

The deferred "`<puzzle-skeleton>` auto-swap" ships in v1.8 (D39): a declarative loading template shown while a component's **first `data()`** is pending, then swapped for the real template. Compiler + runtime + a router amendment; presence-driven — no config surface, no new API to call.

**The section.** An optional fourth `.pzl` section, sibling of `<puzzle-view>`:

```html
<puzzle-view class="post-detail">
  <h1>{ post.title }</h1>
  <p>{ post.body }</p>
</puzzle-view>

<puzzle-skeleton>
  <div class="animate-pulse">
    {#for 1...3}
      <div class="bg-skeleton h-4"></div>
    {/for}
  </div>
</puzzle-skeleton>
```

- At most **one** per file; the `<puzzle-skeleton>` tag itself takes **no attributes** (compile error) — in view mode the skeleton renders under the same `<puzzle-view>` root (and attributes) as the real template, so the loaded swap patches children only.
- The body uses the **full template grammar** (§6). The range `{#for}` is the idiomatic way to repeat placeholder rows. **Only `created()`-seeded state is readable** during a skeleton render — `data()` hasn't resolved, so expressions against the component model will be `undefined`.
- **Component mode (D20):** like the template, the skeleton needs a **single root element**, and it must be a **plain element** (a component root is a compile error). Keep its tag equal to the template root's so the swap patches in place.
- Compiled to a second prototype-assigned method, `Name.prototype.renderSkeleton` — same idiom as `render()` (§4).

**Runtime semantics.** A component is **loaded** once its first `data()` result commits (`view.loaded` getter). While unloaded, a declared skeleton is what renders:

- **Async first `data()`** → the skeleton renders immediately in the reserved position, `mounted()` fires against the skeleton DOM, and the mount no longer waits on data — a child component's enter animation (§12) plays on the skeleton, and the real render patches over it (bracketed by `beforeUpdate`/`afterUpdate`) when the data commits.
- **Synchronous / already-resolved `data()`** → the skeleton never appears.
- **`loaded` never resets.** Later refreshes (store change, prop/param change) keep the CURRENT content on screen until the new data commits (§4 last-wins) — a skeleton is a first-load affordance, not a spinner.
- A `data()` rejection while the skeleton is up is **logged and the skeleton stays** — surfacing load errors is the view's job (catch in `data()` and return an error model).

**Routing (the one D19 amendment).** A **fresh** routed view (or layout) that declares a skeleton **does not gate the navigation commit on its `data()`**: the navigation proceeds without awaiting the load, the view mounts showing its skeleton, and the real content patches in when `data()` commits. Reused ancestors **always** gate (visible content never regresses mid-navigation), and skeleton-less views keep the await-then-commit semantics byte-for-byte. *(Since v1.28, §30/D61, the location commit itself rides the swap: in sequential mode the URL/title still move only after the outgoing view's `out` animation — the skeleton exemption bypasses the DATA gate, not the transition.)* The traded guarantee, accepted knowingly: for a skeleton view, a failed load can leave the URL pointing at a view still showing its skeleton (error logged) — the URL commits to the page's *declared loading state* rather than its data.

**Anti-flash hold (v1.20, D52).** The section tag accepts exactly one optional attribute — `min-duration`, a static unsigned integer in milliseconds: `<puzzle-skeleton min-duration="300">`. Once the skeleton has rendered, the loaded swap is held until at least that long after it appeared (data arriving later swaps immediately, as always). Last-wins is preserved — refreshes during the hold update the pending model and one swap lands at expiry with the latest data; destroy cancels the hold. Absent = 0 = v1.8 behavior byte-identical. Any other attribute, a dynamic/interpolated value, or a malformed number is a compile error. Compiled as a prototype assignment beside `renderSkeleton` (`skeletonMinDuration`).

**Settled in v1.20 (D52):**

- The timeout/error slot (`<puzzle-skeleton error>…`) is **won't-build** — error presentation stays in the real template via the data model (catch in `data()`, return an error model); a declarative error section couldn't even read the error (only `created()`-seeded state is visible there).
- Delay-before-show is **rejected** — it would render an empty root during the delay, a blank state the D19 immediate-commit exists to prevent.
- Skeletons on refresh/params-only navigations stay deliberately excluded (see `loaded` above).

## 32. `this.memo()` — reference-stable derived values (v1.29)

`PuzzleView` gains one method (D64):

```js
memo(key, deps, factory)
```

Per-instance cache keyed by `key` (string): returns the cached value while `deps` (an array) matches the previous call for that key positionally by `Object.is` (length change = miss); otherwise calls `factory()`, caches, and returns the fresh value. Synchronous; no reactivity semantics of its own — it exists purely to give values returned from `data()` a stable identity across re-runs, because props compare with shallowEqual and object props therefore compare **by reference**:

```js
data(params, props) {
  const { effect = 'carousel' } = this.getData();
  return {
    carouselOptions: this.memo('opts', [effect], () => ({
      effect, loop: true, slidesPerView: 2,
    })),
  };
}
```

This is the blessed pattern for object/array props (inline object literals in templates remain a compile error, §6): build in `data()`, wrap in `this.memo(...)` keyed by the ingredients. Combined with §31, a child re-runs `data()` only when a prop meaningfully changes. `memo` is a reserved method name on `PuzzleView`.

## 34. App lifecycle hooks (v1.31)

Three optional function fields on the PuzzleApp config — the sanctioned home for app-level setup (store seeding before the first render) and teardown (persistence flushes). Shipped in v1.31 (D66), the triage outcome of the app-surface umbrella: **only lifecycle hooks were admitted**; app-level `settings`/`computed`/`methods`, global events (incl. keyboard-shortcut strings), the `$events` bus, `ctx.utils`, and a devtools hook stay re-rejected (see the cut list and DECISION-D66). All fields optional — an app using none behaves byte-identically.

```js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  async beforeMount(app) {
    // services are wired, navigation #0 has NOT run: seed here and the
    // first data() sees real records (retires `app.mount().then(seed)`)
    seedTasks.forEach((t) => app.store.createRecord('task', t));
  },
  mounted(app) {
    // initial route rendered (and dev HMR state restored)
    window.addEventListener('beforeunload', persist);
  },
  beforeUnmount(app) {
    // teardown not started: the store is still readable
    persist();
    window.removeEventListener('beforeunload', persist);
  },
});
```

- **`beforeMount(app)`** — runs inside `mount()` after the three ctx services are wired (`app.store`/`app.router`/`app.formatters` live), immediately before `router.start()` (navigation #0). **Awaited**: an async hook completes before the first `data()` runs. A throw or rejection **aborts the mount** — the app is torn back down to the unmounted state and `mount()` rejects with that error (re-mounting later is legal; `beforeUnmount` does not fire on this abort path). An `unmount()` during an in-flight async `beforeMount` wins: the router never starts. *(Amended, D118: every `mount()` attempt claims a private generation token, burned by any teardown — so a stale continuation, including one racing a NEWER `mount()` that reclaimed the app, can neither start the router, restore HMR state onto the new cycle's tree, fire `mounted` a second time, nor tear the newer cycle down from its own abort path.)* *(Amended, D136: a rejected `router.start()` — navigation #0 failing its commit — aborts the same way: epoch-guarded teardown, `mount()` rejects, re-mounting later is legal. Post-commit `render()`/`mounted()` failures stay observed-and-logged per D115 and do not reject `start()`.)*
- **`mounted(app)`** — runs after the initial route has rendered and the dev HMR restore (§27) has applied. **Not awaited**; a throw or async rejection is caught and logged (`[puzzle]` prefix), never rejecting a mount that succeeded (same posture as morph-handler errors, D55).
- **`beforeUnmount(app)`** — runs at the top of `unmount()`, before any teardown, with services still live. Only fires when actually mounted (idempotent `unmount()` never double-fires). Synchronous call: a returned promise is not awaited and cannot delay teardown; a throw is caught and logged and teardown proceeds. A returned promise's **rejection** is likewise observed and logged (§35) — never an unhandled rejection.
- Each hook receives the app instance as its argument (`this` is also the app for `function`-form hooks). Hooks re-fire on every mount/unmount cycle. A non-function, non-nullish hook value throws at `mount()` time, before any wiring.
- `beforeMount` delays navigation #0 by design — seed local data there; a slow network fetch belongs in view `data()` behind a `<puzzle-skeleton>` (§16), which cannot render during `beforeMount`.

## 37. Cross-view morphs — sibling-swap capture flights in `enableMorph` (v1.35)

An amendment (D68) to the v1.23 shared-element morph integration (D55 — whose base contract lives in its decision card; morph predates numbered SPEC sections). Elements sharing a `data-puzzle-morph` value now morph across **sibling view swaps** automatically — both directions, pops included — with no app code beyond the existing `enableMorph(app)`. Default-on, no new options, no new dependencies.

**The gap:** D55 pairs only elements that coexist in the DOM (nested-route dialogs, where the source stays mounted). Sequential transitions (D28) destroy a sibling view before its replacement mounts, so a list→detail navigation had no pairing moment; the music example bridged it app-side with a capture-at-click helper (`art-morph.js`, forward-only, per-card handlers).

**The mechanism (all in `client-runtime/morph.js` — the router is untouched, D55's one-slot posture holds):**
- **Capture at leave.** The handler's `leave(el)` fires at out-phase start while the outgoing subtree is still connected and measurable. After the unchanged D55 fly-back logic, it snapshots every measurable `[data-puzzle-morph]` element in the leaving subtree (`Map<id, {el, rect}>` — detached refs stay cloneable after destroy). This is what makes back/forward pops and programmatic navigations morph.
- **Click candidate (polish).** One delegated capture-phase document click listener records a candidate ref (+timestamp; zero DOM work; `typeof document` guard for the D67 node prerender). If fresh (<5 s) and inside the leaving subtree, `leave()` pins a fixed-position clone over it pre-fade (morph attribute stripped from the clone; 2 s TTL fade) so the art visually holds still while the old view animates out.
- **Fly at enter.** `enter(el)` scans all morph elements in the entering subtree. A live counterpart outside the subtree wins (existing D55 pair + fly-back path — unchanged priority); otherwise the first element whose id matches a capture gets a **clone flight**: the pinned clone if ids match, else a clone built pre-paint from the snapshot at its recorded rect. Clone flights are one-shot — they never set the fly-back pair; the reverse trip comes from the next leave's fresh capture. Post-settle unwind: the clone is always removed; `engine.stop()` only when `show()` settled true (false = superseded by a newer flight that owns the engine).
- **Skeleton-deferred targets.** If captures exist but the entering subtree has no morph element yet (§16 skeleton views — the real template lands after `data()`), a MutationObserver scoped to the animator element waits (2 s TTL) for a measurable matching element and then flies.
- **Cleanup.** Captures are per-navigation (discarded at the next leave/enter); a failed or superseded navigation (D61: nothing commits, enter never fires) is cleaned by the pinned clone's TTL. `prefers-reduced-motion` disables all capture; `options.attribute` flows through every selector.

**Rules:** D55's element rules apply, plus the capture-flight target's view should declare an opacity-only `in` animation (or none) — the engine measures the target rect once at flight start, so a transform entrance slides the real element away from where the blob lands (documented, not enforced). Still one flight per transition and one shared engine. Deep links (navigation #0) never morph.

**Directional morph roles (v1.36, D69):** three spellings share one id namespace. Plain `data-puzzle-morph="id"` is the symmetric surface — launches AND receives, the D55/D68 default, unchanged. `data-puzzle-morph-trigger="id"` launches only (eligible for leave snapshots, click-pins, and as a live-pair source; never a landing spot). `data-puzzle-morph-target="id"` receives only, and is **preferred over a plain element** when the same id appears more than once in the arriving view (a detail header beats a featured card lower in the page) — it never launches anything, including as a live-pair source. Ids match across all three, so trigger→target pairs are automatically **forward-only**: list→detail morphs, detail→list renders plainly. Direction is a property of the element (the flight shape), not of history — back-shaped pushes behave identically to pops. When multiple triggers share an id in the leaving view, the clicked one launches; document order breaks ties otherwise, and a warn-once duplicate-id guard teaches the resolution (silent for the endorsed trigger+target pattern). All three spellings derive from an `options.attribute` override (`data-x` → `data-x-trigger`/`data-x-target`). Symmetric plain↔plain pairs keep the full D55 round-trip contract.

## 38. Element refs — `ref="name"` → `this.refs` (v1.39)

A static `ref="name"` attribute on a **plain element** binds that element's live DOM node to `this.refs.name` on the owning view (D72). The attribute is framework-owned — stripped from the DOM like `key`/`island` — and the name must be a bare identifier (it becomes a property of `this.refs`).

**Lifecycle contract:** `this.refs.name` is the mounted element, `null` when not mounted. Populated during mount, **before `mounted()` fires** — usable there with no guard. A keyed or tag replacement **re-points** the ref at the new element; removal (an `{#if}` toggling off, a list row leaving, view teardown) nulls it. Outside `mounted()`, guard with `?.` — the same discipline as the `@ready` idiom. `refs` is an instance field, not render data: never in `getData`/`setData`, never in HMR snapshots (§27), dropped by the SSG serializer (§36) like `@event`/`key`/`island`.

**Compilation:** codegen emits `ref: this.__ref("name")` in the vnode attrs — `__ref` returns a per-instance **cached** setter (stable identity across renders, the §31 lesson applied at birth), with a guarded-removal signature that makes patch-time mount/remove ordering irrelevant. The ViewManager stays view-agnostic: like event handlers, the closure carries the view. `refs` and `__ref` join the §4 reserved names.

**Compile errors (all positioned):** dynamic `ref={ expr }` or mixed/interpolated value (the §6 expression boundary makes a braces form unimplementable — identifiers in braces are data reads); empty or valueless `ref`; a non-identifier name; `ref` on a component tag (use the `@ready` callback prop — a component's root element is its own business); on `<slot>`; on the `<puzzle-view>` root (that's `this.element`); inside `{#for}` (per-iteration array refs deferred); inside `<puzzle-skeleton>` (skeleton nodes die at the real-template swap); duplicate ref names in one template.

**The headline combo is `ref` + `island` (§17):** `<svg island ref="scene">` + a rAF loop in `mounted()` is the sanctioned zero-diff animation path — the ref delivers the node, the island guarantees hand-mutations survive every re-render, and per-frame work never touches render/diff.

## 39. Scroll-triggered enter animations — `trigger: 'visible'` (v1.40)

An `in` spec (§12) accepts two additional optional keys (D73): `trigger: 'mount' | 'visible'` and `triggerOffset`. Absent or `'mount'` is today's behavior, byte-identical. With `'visible'`, the enter animation does not play at mount — the element is **held at its `from` keyframe** (a paused WAAPI animation; `fill: 'both'` holds the pre-state, so there is no flash of natural-state content) and plays **once**, the first time the element enters the viewport.

```js
animations = {
  in: {
    from: { opacity: 0, transform: 'translateY(24px)' },
    to:   { opacity: 1, transform: 'translateY(0)' },
    duration: 500,
    easing: 'ease-out',
    trigger: 'visible',
    triggerOffset: '15%',   // optional — trigger line above the viewport bottom (px number or '%' string)
  },
};
```

**Observation.** A module-level registry (`client-runtime/views/visibility.js`) keeps **one shared IntersectionObserver per distinct rootMargin**, threshold 0, and disconnects an observer when its last target disarms. `triggerOffset` maps to `rootMargin: '0px 0px -<offset> 0px'` — the trigger-line-from-viewport-bottom model adopted from `@magic-spells/scroll-trigger`. An element already in view at mount reveals on the observer's initial callback (~one frame later).

**Anchored triggering.** An optional `triggerAnchor: '<css selector>'` makes the instance observe an **ancestor** element instead of its own root — resolved once at arm time via `this.element.closest(selector)`. All children anchored to the same element reveal in the same frame when it crosses the trigger line (per-child `delay` provides the choreography); the registry holds multiple callbacks per observed element, still one shared observer. Ancestor-only is deliberate: an ancestor's lifetime contains the child's, so anchor teardown can never dangle. No match at arm time → warn once per spec object, fall back to observing the own root (content never stranded behind a typo). `triggerOffset` composes with the anchor. Rows of a `{#for}` share one class and therefore one spec — anchored, they reveal together with identical timing (a per-index stagger knob is deferred). `triggerAnchor` without `trigger: 'visible'` warns once and is ignored.

**Lifecycle.** The `viewWillShow()` → `in` → `viewDidShow()` bracket **defers as a unit** to the actual reveal; `mounted()` timing is unchanged (it fires at mount, before the hold). The reveal runs at most once per mount — scrolling away and back does not replay; a keyed remount is the re-reveal idiom. `playIn()`'s promise stays pending until the reveal completes (or the instance is destroyed) — every caller is fire-and-forget, so navigation is never held open. Fill-release (§12) still applies after the reveal: `to` must equal the natural resting style.

**Degradation — content is never stranded hidden; every failure lands on `'mount'` behavior:** no `IntersectionObserver` global (jsdom, ancient browsers) → play at mount; **`prefers-reduced-motion` → no hold at all** — content renders immediately with the usual zeroed durations, hooks fire at mount; unknown `trigger` value or malformed `triggerOffset` → warn once per spec object, fall back; a WAAPI create/pause/play throw → instant reveal; a throwing `viewWillShow()`/`viewDidShow()` inside the reveal is logged and never blocks the play or the `playIn()` settlement — the reveal fires from an IntersectionObserver delivery long after `playIn()` returned, so no caller could observe the throw (D118). `destroy()` before the reveal disarms the observer, resolves the pending `playIn()`, and skips the hooks (the destroyed-mid-enter rule). A `trigger` key on `out` warns once and is ignored — a leaving element cannot be visibility-triggered.

**Scope.** Any PuzzleView — components are the point; routed views/layouts are allowed but are normally in-viewport at mount, so `'visible'` simply plays immediately (harmless — the D65 don't-restrict-document posture). Runtime-only amendment: the compiler never parses the `animations` field; ViewManager patch paths, router, and SSG serializer are untouched. On prerendered pages (§36), static markup renders in natural state and below-fold components hold-and-reveal once the page's interactive layer mounts — the router takeover in `hybrid` mode, `mountStatic` in `static` mode.

## 46. FLIP keyed-reorder animation: the `flip` directive attribute (v1.51)

A keyed `{#for}` row root may declare `flip` (bare) or `flip={ flipOptions }` — the options object built in `data()` or script scope, since §6 template expressions do not admit inline object literals — to animate **retained** elements from their old visual position to their new one when keyed reconciliation moves them — First/Last/Invert/Play over the completed patch, so DOM order, accessibility order, and hit testing are already final while only the paint catches up (D85).

- `flip` is a **framework directive** like `key`/`island`/`ref` — stripped from DOM attributes and SSG output, zero new template grammar.
- Translation only (no width/height scaling); position deltas under 0.5 CSS px skip; a pre-existing base transform is composed under the correction and restored untouched; animation state is fully released on settle so author CSS stays authoritative.
- Defaults: `250`ms, `cubic-bezier(0.2, 0, 0, 1)`; malformed options fall back to defaults; unknown keys are ignored.
- A rapid re-reorder measures the element's current **visual** rectangle (mid-flight transform included), cancels the prior Puzzle-owned FLIP (foreign Web Animations are never touched), and animates from there.
- Newly inserted rows keep the enter path (§12/§39); leaving rows keep the out-animation path and are never FLIP candidates. No wrapper elements; the loop key is the only identity system.
- `prefers-reduced-motion` and missing Web Animations mean no measurement work at all; a list with no `flip` attributes (or unchanged order) costs nothing beyond a cheap scan. A `flip` on an unkeyed row warns once (positional-diff lists have no stable identity to animate).
- Simultaneous author-controlled transform *animations* on the same element may conflict — documented; a wrapper element is the escape hatch.

## 60. App-level error handling — `onError` + the app error view `errorView` (v1.67; error-view contract v1.71)

Two optional PuzzleApp config keys (§2) on top of the D115/D136/D143 recovery machinery; both live in a ctx-keyed WeakMap — the documented three-service ctx object is not widened. Full rationale: [[DECISION-D145-ERROR-BOUNDARIES]].

**The funnel.** Every framework-contained app error reports through one funnel (`client-runtime/errors.js`). `onError(error, info)` receives a frozen `info = { phase, view, route }` — phases: `mount`, `refresh`, `navigation`, `transition`, `leave`, `bind`, `error-view`. With no hook registered, the funnel replays the exact `console.error` the catch site always made. A throwing (or rejecting async) `onError` is contained at the funnel with its own `console.error` and never re-enters it. Deliberately not funneled: rethrow-to-caller paths (`beforeMount`, `router.start()`), explicit navigation verdicts (a guard returning false), input-capability fallbacks, and event handlers/formatters — those surface uncaught as ever.

**The error view.** `errorView` registers **one** ordinary compiled view — the default export of any `.pzl` file; a value that is not a view constructor is a construction-time config error. When a framework-contained mount/refresh failure lands, the runtime — after the funnel report — destroys the failed instance and mounts a fresh error-view instance at the exact failed position (**replacement, never re-render**: an instance whose `data()` or render just threw is never asked to render its own fallback). Parent, siblings, and the surrounding layout keep their state. The error view is a normal PuzzleView receiving props `error` (the failure as thrown), `info` (the same frozen object the funnel passed), and `retry` (a callback, identity-stable for the error view's lifetime).

**Retry** rebuilds through the position's normal owner, never a second engine: for a routed view/layout the Router forces a same-location replace through the normal navigation pipeline (`chainInvalid` forces `keep = 0`, so the whole chain re-runs constructor → `created()` → `data()` → render → mount); for a child component the D115 placeholder stays at the vnode position and the parent's ordinary `refresh()` remounts a fresh child — props and slots re-derived, not replayed. A retry never blanks its position: the error view stays mounted for the whole routed rebuild, and that position is vacated only by something that immediately refills it — a successful commit (which disposes the face as it mounts the rebuilt chain) or a load-phase failure, which swaps in a face carrying the new error and a fresh callback. Every other pre-commit exit (guard block, guard redirect that no-ops, supersession) leaves the face standing with the error it already had. The component path is the exception: `patchComponent` remounts only a position it finds without a face, so retry releases it on dispatch and the owner's re-render refills it. Single-flight spans one press — a concurrent second call is ignored, and the latch re-arms when the rebuild ends with the same face still mounted, so a blocked or superseded retry stays pressable. The callback is bound to the error-view instance it was handed to: a replaced face's callback is permanently spent, and a retry after the position was already removed is a no-op. Nothing retries automatically, ever.

**Edges.** The error view itself failing reports once with `phase: 'error-view'` and stops — the runtime never mounts an error view for the error view; the failed-mount placeholder stays recoverable. SSG takeover: a failed takeover mount renders the error view first; only when none is configured (or it also failed) is the prerendered page restored. Prerender-time failures (both output modes) fail the build — the error view never renders into generated HTML. With no `errorView` configured, the funnel still reports every failure and failed positions keep the invisible D115 recovery placeholder. There is no per-view error API — no `errorContent`, no boundary walk, no `<ErrorBoundary>` marker.

