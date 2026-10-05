---
name: SPEC — view runtime, lifecycle, and animation
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ANIMATIONS
  - DECISION-D145-ERROR-BOUNDARIES
verified_at: '2026-08-24T05:28:12.855Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
notes:
  - kind: state
    text: >-
      `afterUpdate(prev)` (D178, DECISION-D178-AFTERUPDATE-PREV): the hook receives a frozen,
      shallow snapshot `{ props, params, route, data }` of what the previous render drew
      (`PrevViewState` in types). The snapshot is taken as each render lands, in `#renderNowInner`
      (mount render included), not when the update starts. A record in `prev.data` is the same live
      object as in `this.data`, so an edit to that record is invisible to `!==`; return the field
      from `data()` (`title: post.title`) and compare that. Only views that override `afterUpdate`
      pay for it; prerender never calls it. The full rule set is on D178 and DOC-VIEW-LIFECYCLE §3.
---

The contract for the view runtime: animations, skeleton loading, `this.memo()`, app lifecycle hooks, cross-view morphs, element refs, scroll-triggered enters, the `flip` directive, and app-level error handling. See [[DOC-SPEC]] for the section index.

## 12. Animations

Declarative enter/leave animations on views, layouts and components via the Web Animations API (D28).

```js
animations = {
  in:  { from, to, duration, easing?, delay? },   // in may also carry trigger/triggerOffset/triggerAnchor (§39)
  out: { from, to, duration, easing?, delay? },
};
```

- Each spec compiles to `el.animate([from, to], { duration, easing, delay, fill: 'both' })` (`from`/`to` keyframe objects, ms durations, any CSS easing). An omitted key runs instantly. A malformed spec **warns once and is skipped**.
- **Target:** the instance's own root — `<puzzle-view>` for views/layouts, the single root element for components (D20). No wrapper element.
- **Out animations in lists require keys.** The keyed reconciler patches around a leaving element (`leavingEls`); the unkeyed path cannot, so survivors may misorder. Development warns once per session when an unkeyed list unmounts an out-animated component.
- **Completion** via `Animation.finished`. Interrupting navigation or unmount **cancels** and proceeds immediately.
- **Enter releases on finish:** filled styles are cleared after `in` settles, so `to` **must equal the element's natural resting style**, or it snaps.
- **Reduced motion** (`prefers-reduced-motion: reduce`) zeroes all durations; hooks still fire in order.
- **Height animations need explicit px values** — WAAPI cannot animate to `height: auto`.

**Lifecycle hooks.** Four no-op `PuzzleView` methods: `viewWillShow()` → `in` → `viewDidShow()`, and `viewWillHide()` → `out` → `viewDidHide()`. They are lifecycle, not animation callbacks — **they fire in order even with no `animations` field**. `mounted()` precedes `viewWillShow()`; `viewDidHide()` precedes `destroyed()`. A view declaring the hide hooks without `animations.out` also takes the animated removal path (its element lingers a microtask).
- A throwing `destroyed()` is caught and logged; the surrounding teardown (parent destroy, `Router.stop()`, `PuzzleApp.unmount()`) always completes (D118).
- An enter requested while the first render is still pending defers and replays after `mounted()` on the real root (D136).
- A **leaving** view is inert from `playOut()` start: its store subscription drops immediately and `refresh`/`setData`/store-change/parent-update deliveries are ignored.
- A view restored after a failed navigation mid-leave fires the show bracket again (`viewWillShow()` → `viewDidShow()`, zero-duration, each hook contained) before its eventual real leave fires the full hide bracket.

**The hide bracket pairs with the mount.** Hide hooks and `out` fire only for a view that reached `mounted()`. A component removed while its first `data()` was pending takes the instant `destroy()` — pending run cancelled, subscription dropped, `destroyed()` fires, no hide hooks — so teardown of `viewDidShow()` state never runs against state never created. A view with a `<puzzle-skeleton>` (§16) **is** mounted once the skeleton renders, so it leaves with the full bracket.

**Route transitions** are sequential by default: after the new chain's `data()` resolves (D19), the old view plays `out` and is destroyed, then — in one synchronous block with the new mount (§30) — URL and title commit and the new view plays `in`. A navigation superseded or failed during the out commits nothing. The enter is fire-and-forget. Overlap is opt-in (§26). **One animator per transition:** a view swapped inside a reused layout animates alone; on a layout swap the layout animates and its view rides along.

## 16. Skeleton loading

A declarative loading template shown while a component's **first `data()`** is pending, then swapped for the real template (D39). Presence-driven: no config, no API.

```html
<puzzle-view class="post-detail">
  <h1>{ post.title }</h1>
</puzzle-view>

<puzzle-skeleton min-duration="300">
  <div class="animate-pulse">
    {#for 1...3}<div class="bg-skeleton h-4"></div>{/for}
  </div>
</puzzle-skeleton>
```

- At most **one** per file. The only allowed attribute is `min-duration` — a static unsigned integer in ms (D52); anything else, a dynamic value, or a malformed number is a compile error. In view mode the skeleton renders under the same `<puzzle-view>` root, so the swap patches children only.
- The body uses the full template grammar. **Only `created()`-seeded state is readable** — the model is not loaded yet.
- **Component mode:** a single **plain-element** root (a component root is a compile error); keep its tag equal to the template root's so the swap patches in place.
- Compiled to `Name.prototype.renderSkeleton` beside `render()`, with `skeletonMinDuration` beside it.

**Runtime.** A component is **loaded** once its first `data()` commits (`view.loaded`).
- **Async first `data()`** → the skeleton renders immediately, `mounted()` fires against it, and the mount does not wait on data; child enters play on the skeleton, and the real render patches over it (bracketed by `beforeUpdate`/`afterUpdate`) when data commits. All §61 settle rounds count as one load.
- **Synchronous/resolved `data()`** → the skeleton never appears.
- **`loaded` never resets**: later refreshes keep current content until new data commits — a first-load affordance, not a spinner.
- A `data()` rejection while the skeleton is up is **logged and the skeleton stays** — catch in `data()` and return an error model (or rely on §60).
- **`min-duration`** holds the swap until that long after the skeleton appeared; data arriving later swaps immediately. Refreshes during the hold update the pending model and one swap lands at expiry; destroy cancels the hold.

**Routing exemption.** A **fresh** routed view or layout with a skeleton does **not** gate the navigation commit on its `data()`: it mounts showing the skeleton and patches in later. Reused ancestors **always** gate; skeleton-less views keep await-then-commit. In sequential mode the URL still moves only after the outgoing `out` (§30) — the exemption bypasses the data gate, not the transition. Traded guarantee: a skeleton view's failed load can leave the URL on a view still showing its skeleton.

**Rejected:** an error slot (`<puzzle-skeleton error>` — it could not read the error; errors live in the data model or §60); delay-before-show (it would render an empty root); skeletons on refresh/params-only navigations.

## 32. `this.memo()` — reference-stable derived values

`memo(key, deps, factory)` (D64): a per-instance cache keyed by string; returns the cached value while `deps` (an array) matches the previous call positionally by `Object.is` (length change = miss), else calls `factory()`, caches and returns it. Synchronous, no reactivity of its own. It exists because props compare with shallowEqual, so object props compare **by reference**:

```js
data(params, props) {
  const { effect = 'carousel' } = this.getData();
  return {
    carouselOptions: this.memo('opts', [effect], () => ({ effect, loop: true, slidesPerView: 2 })),
  };
}
```

This is the blessed pattern for object/array props: build in `data()`, wrap in `this.memo(...)` keyed by the ingredients. A prop expression cannot start with an object literal (one is legal only as a function argument or nested inside another expression, D173), and a literal built in the template would be fresh each render anyway. `memo` is a reserved method name.

## 34. App lifecycle hooks

Three optional PuzzleApp config functions (D66) — the home for app-level setup and teardown.

```js
const app = new PuzzleApp({
  target: '#app', routes, models,
  async beforeMount(app) { seedTasks.forEach((t) => app.store.createRecord('task', t)); },
  mounted(app) { window.addEventListener('beforeunload', persist); },
  beforeUnmount(app) { persist(); window.removeEventListener('beforeunload', persist); },
});
```

- **`beforeMount(app)`** runs inside `mount()` once services are wired (`app.store`/`app.router`/`app.formatters`, and `app.i18n` when configured), before navigation #0. **Awaited**, so seeding here reaches the first `data()`. A throw or rejection **aborts the mount**: the app tears back down, `mount()` rejects with that error, `beforeUnmount` does not fire, and re-mounting later is legal. An `unmount()` during an in-flight `beforeMount` wins — the router never starts. After it, `mount()` awaits the locale table when `i18n` is configured (a total load failure aborts the same way), then the HMR restore, then `router.start()`.
- Every `mount()` claims a private generation token burned by any teardown, so a stale continuation — even one racing a newer `mount()` — cannot start the router, restore HMR state, fire `mounted` twice, or tear down the newer cycle (D118). A rejected `router.start()` (navigation #0 failing its commit) aborts the same way (D136); post-commit `render()`/`mounted()` failures are reported (§60) and do not reject.
- **`mounted(app)`** runs after the initial route rendered and the HMR restore applied. **Not awaited**; a throw or rejection is caught and logged.
- **`beforeUnmount(app)`** runs at the top of `unmount()` with services live, only when actually mounted (idempotent). Synchronous: a returned promise is not awaited, and its rejection is logged; a throw is logged and teardown proceeds.
- Hooks receive the app (and `this` is the app for `function` form), re-fire every mount/unmount cycle, and a non-function non-nullish value throws at `mount()` before any wiring.
- A slow network fetch belongs in view `data()` behind a skeleton, not in `beforeMount`, which delays navigation #0.
- Rejected at the same triage: app-level `settings`/`computed`/`methods`, global events, the `$events` bus, `ctx.utils`, an app-config devtools hook.

## 37. Cross-view morphs — sibling-swap capture flights in `enableMorph`

Elements sharing a `data-puzzle-morph` value morph across **sibling view swaps** — both directions, pops included — with only `enableMorph(app)` (D68, on top of the D55 base contract in [[DECISION-D55-MORPH-TRANSITIONS]]). All in `client-runtime/morph.js`; the router is untouched and D55's one-slot handler holds.

- **Capture at leave.** `leave(el)` fires at out-start while the old subtree is measurable; after D55's fly-back logic it snapshots every measurable morph element there (`Map<id, {el, rect}>`).
- **Click candidate.** One delegated capture-phase document click listener records the clicked ref (zero DOM work; guarded for Node prerender). If fresh (< 5 s) and inside the leaving subtree, `leave()` pins a fixed-position clone over it (morph attribute stripped; 2 s TTL) so the art holds still while the old view fades.
- **Fly at enter.** `enter(el)` scans the entering subtree. A live counterpart outside it wins (D55 pair + fly-back); otherwise the first element matching a capture gets a one-shot **clone flight** (the pinned clone if ids match, else a clone built from the snapshot rect). Clone flights never set the fly-back pair. After settle the clone is removed; `engine.stop()` only when `show()` settled true.
- **Skeleton targets.** With captures but no morph element yet, a MutationObserver on the animator waits (2 s TTL) for a measurable match, then flies.
- **Cleanup.** Captures are per navigation; a failed navigation is cleaned by the clone's TTL. Reduced motion disables capture; `options.attribute` flows through every selector.
- **Rules:** D55's element rules apply; a capture-flight target's view should use an opacity-only `in` (or none), since the landing rect is measured once. One flight per transition, one shared engine. Navigation #0 never morphs.

**Directional roles (D69).** Three spellings share one id namespace: plain `data-puzzle-morph` launches and receives (symmetric, full D55 round trip); `data-puzzle-morph-trigger` launches only (leave snapshots, click pins, live-pair source; never lands); `data-puzzle-morph-target` receives only and is **preferred over a plain element** with the same id in the arriving view; it never launches. Trigger→target pairs are therefore forward-only (list→detail morphs, detail→list renders plainly) — direction is a property of the element, not of history. With several triggers sharing an id, the clicked one launches, else document order; a warn-once duplicate-id guard teaches this (silent for trigger+target). All three derive from an `options.attribute` override (`data-x` → `data-x-trigger`/`data-x-target`).

## 38. Element refs — `ref="name"` → `this.refs`

A static `ref="name"` on a **plain element** binds its live DOM node to `this.refs.name` (D72). The attribute is framework-owned — stripped from the DOM and from SSG output like `key`/`island` — and the name must be an identifier.

- `this.refs.name` is the mounted element, or `null`. It is populated **before `mounted()`**; a keyed or tag replacement re-points it; removal (`{#if}` off, row leaving, teardown) nulls it. Outside `mounted()` guard with `?.`. `refs` is an instance field — never in `getData`/`setData` or HMR snapshots.
- Codegen emits `ref: this.__ref("name")`; `__ref` returns a per-instance **cached** setter (stable identity) whose guarded removal makes patch ordering irrelevant. The ViewManager stays view-agnostic. `refs` and `__ref` are reserved names.
- **Positioned compile errors:** a dynamic `ref={ expr }` or interpolated value; empty or valueless `ref`; a non-identifier name; `ref` on a component (use an `@ready` callback prop), on a `<Slot>`, `<Children>` or `<Portal>` marker, or on the `<puzzle-view>` root (that is `this.element`); inside `{#for}` (no per-iteration refs); inside `<puzzle-skeleton>`; inside a `<Snippet>` body; duplicate names in one template.
- **`ref` + `island` (§17)** is the sanctioned zero-diff animation path: `<svg island ref="scene">` plus a rAF loop in `mounted()`.

## 39. Scroll-triggered enter animations — `trigger: 'visible'`

An `in` spec accepts `trigger: 'mount' | 'visible'`, `triggerOffset` and `triggerAnchor` (D73). Absent or `'mount'` is the normal enter. With `'visible'` the element is **held at its `from` keyframe** (a paused WAAPI animation with `fill: 'both'`, so no flash) and plays **once**, the first time it enters the viewport.

```js
animations = {
  in: { from: { opacity: 0, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'translateY(0)' },
        duration: 500, easing: 'ease-out', trigger: 'visible', triggerOffset: '15%' },
};
```

- **Observation** (`client-runtime/views/visibility.js`): one shared IntersectionObserver per distinct rootMargin, threshold 0, disconnected when its last target disarms. `triggerOffset` (px number or `'%'` string) maps to `rootMargin: '0px 0px -<offset> 0px'` — a trigger line above the viewport bottom. An element already in view reveals on the initial callback.
- **`triggerAnchor: '<selector>'`** observes an **ancestor** (resolved once at arm time via `this.element.closest()`), so everything anchored to it reveals in the same frame (per-child `delay` choreographs). Ancestor-only so anchor teardown can never dangle. No match → warn once per spec, observe the own root. Without `trigger: 'visible'` it warns once and is ignored. `{#for}` rows share one spec and so reveal together.
- **Lifecycle:** the `viewWillShow()` → `in` → `viewDidShow()` bracket defers as a unit to the reveal; `mounted()` timing is unchanged. At most one reveal per mount (a keyed remount re-reveals). `playIn()` stays pending until the reveal or destroy; callers are fire-and-forget. Fill-release (§12) still applies.
- **Degradation lands on `'mount'` behavior, never stranded content:** no `IntersectionObserver` → play at mount; **reduced motion → no hold at all**; unknown `trigger` or malformed `triggerOffset` → warn once per spec, fall back; a WAAPI throw → instant reveal; a throwing show hook inside the reveal is logged and never blocks it (D118). `destroy()` before the reveal disarms, resolves `playIn()`, and skips the hooks. A `trigger` on `out` warns once and is ignored.
- **Scope:** any PuzzleView; runtime-only (the compiler never parses `animations`). On prerendered pages below-fold components hold-and-reveal once the interactive layer mounts (router takeover in hybrid, `mountStatic` in static).

## 46. FLIP keyed-reorder animation: the `flip` directive attribute

A keyed `{#for}` row root may declare `flip` (bare) or `flip={ flipOptions }` (an options object built in `data()` — a template expression cannot start with an object literal) to animate **retained** rows from their old position to their new one after keyed reconciliation moves them — First/Last/Invert/Play over the completed patch, so DOM order, accessibility order and hit-testing are already final (D85).

- A framework directive like `key`/`island`/`ref` — stripped from DOM attributes and SSG output.
- Translation only (no scaling); deltas under 0.5 px skip; a pre-existing base transform is composed under the correction and restored; animation state is fully released on settle.
- Defaults `250` ms, `cubic-bezier(0.2, 0, 0, 1)`; malformed options fall back to defaults; unknown keys are ignored.
- A rapid re-reorder measures the current **visual** rect (mid-flight transform included), cancels the prior Puzzle-owned FLIP (foreign animations untouched), and animates from there.
- Inserted rows take the enter path (§12/§39); leaving rows take the out path and are never FLIP candidates.
- Reduced motion or no Web Animations → no measurement at all; a list with no `flip` (or unchanged order) costs a cheap scan; `__PUZZLE_HAS_FLIP__ = false` drops it from the bundle (§54). A `flip` on an unkeyed row warns once.
- Author transform *animations* on the same element may conflict; a wrapper element is the escape hatch.

## 60. App-level error handling — `onError` + the app error view `errorView`

Two optional PuzzleApp config keys over the D115/D136/D143 recovery machinery; both live in a ctx-keyed WeakMap, so ctx is not widened. Rationale: [[DECISION-D145-ERROR-BOUNDARIES]].

**The funnel** (`client-runtime/errors.js`). Every framework-contained error reports through one funnel. `onError(error, info)` receives a frozen `info = { phase, view, route }`. The twelve phases — `mount`, `refresh`, `render` (a scheduled `setData` re-render flush), `bind`, `enter`, `leave`, `unmount`, `navigation`, `transition`, `app-mount`, `app-unmount`, `error-view` — are pinned in the type tests (`PuzzleErrorInfo`), so a new emission site cannot ship without its member. The first loaded swap a skeleton hold (D52) defers to its timer reports `mount`, for a routed view too. `view`/`route` are `null` where the site has none; the app phases always carry `view: null`. With no hook, the funnel replays the `console.error` the catch site always made. A throwing or rejecting `onError` is contained with its own `console.error` and never re-enters. **Not funneled:** rethrow-to-caller paths (`beforeMount`, `router.start()`), explicit verdicts (a guard returning `false`), input-capability fallbacks, event handlers.

**Only current-run failures report.** One supersession predicate governs both outcomes: a refresh whose token moved, or whose view is destroyed or leaving, is discarded whether it fulfilled or rejected, and §61's settle loop drops a stale pass's rejection like its success — so discarded work never reaches `onError` or the error view.

**The error view.** `errorView` registers **one** ordinary compiled view (a non-constructor is a construction-time error). When a mount/refresh failure lands, the runtime reports, destroys the failed instance, and mounts a fresh error-view instance **at the exact failed position** — replacement, never re-render. Parent, siblings and layout keep their state. Props: `error` (as thrown), `info` (the same frozen object), `retry` (identity-stable for the error view's life).

**Retry** rebuilds through the position's normal owner. For a routed view/layout the router forces a same-location replace (`chainInvalid` → keep = 0: constructor → `created()` → `data()` → render → mount). For a child component the D115 placeholder stays and the parent's `refresh()` remounts a fresh child (props and slots re-derived). **A retry never blanks its position:** the routed face stays mounted until a successful commit disposes it or a load failure swaps in a face with the new error and a fresh callback; any other pre-commit exit (guard block, no-op redirect, supersession) leaves the face with its old error. For a component, retry releases the position on dispatch and the owner's re-render refills it; if the owner's `refresh()` itself rejects, the runtime refills the position with a new face and reports the owner's failure once as `phase: 'refresh'`. **Single-flight per press:** a concurrent second call is ignored, and the latch re-arms when the rebuild ends with the same face mounted. A callback is bound to its face — a replaced face's callback is spent; a retry after the position was removed is a no-op. Nothing retries automatically.

**Edges.** The error view failing reports once as `error-view` and stops (never an error view for the error view); the placeholder stays recoverable. A failed hybrid takeover renders the error view first, and restores the prerendered page only when none is configured or it also failed. Prerender-time failures fail the build — the error view never renders into HTML. Without `errorView`, failures still report and positions keep the invisible D115 placeholder. There is no per-view error API (`errorContent`, boundary walk, `<ErrorBoundary>`).
