---
name: SPEC — view runtime, lifecycle, and animation
kind: reference
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ANIMATIONS
  - COMPONENT-MORPH
  - DECISION-D145-ERROR-BOUNDARIES
---

The contract for the view runtime: animations, skeleton loading, `this.memo()`, app lifecycle hooks, cross-view morphs, element refs, scroll-triggered enters, the `flip` directive, and app-level error handling. Hooks, `afterUpdate(prev)` and `renderTick()` are in [[DOC-SPEC-ANATOMY]] §4; `app.idle()` is §2. See [[DOC-SPEC]] for the section index.

## 12. Animations

Declarative enter/leave animations on views, layouts and components via the Web Animations API ([[DECISION-D28-ANIMATIONS]]).

```js
animations = {
  in:  { from, to, duration, easing?, delay? },   // in may also carry trigger/triggerOffset/triggerAnchor (§39)
  out: { from, to, duration, easing?, delay? },
};
```

- Each spec runs as `el.animate([from, to], { duration, easing, delay, fill: 'both' })` (keyframe objects, ms durations, any CSS easing). An omitted key runs instantly. A malformed spec **warns once and is skipped**.
- **Target:** the instance's own root: `<puzzle-view>` for views/layouts, the single root element for components. No wrapper element.
- **Out animations in lists require keys.** The keyed reconciler patches around a leaving element; the unkeyed path cannot, so survivors may misorder. Development warns once when an unkeyed list unmounts an out-animated component.
- **Completion** via `Animation.finished`. An interrupting navigation or unmount **cancels** and proceeds immediately.
- **Enter releases on finish:** filled styles are cleared after `in` settles, so `to` **must equal the element's natural resting style**, or it snaps.
- **Reduced motion** (`prefers-reduced-motion: reduce`) zeroes all durations; hooks still fire in order.
- **Height animations need explicit px values**; WAAPI cannot animate to `height: auto`.

**Lifecycle hooks.** Four no-op `PuzzleView` methods: `viewWillShow()` → `in` → `viewDidShow()`, and `viewWillHide()` → `out` → `viewDidHide()`. They are lifecycle, not animation callbacks: **they fire in order even with no `animations` field**. `mounted()` precedes `viewWillShow()`; `viewDidHide()` precedes `destroyed()`. A view declaring the hide hooks without `animations.out` also takes the animated removal path (its element lingers a microtask).

- A throwing `destroyed()` is caught and logged; the surrounding teardown (parent destroy, `Router.stop()`, `PuzzleApp.unmount()`) always completes.
- An enter requested while the first render is still pending replays after `mounted()` on the real root.
- A **leaving** view is inert from `playOut()` start: its store subscription drops immediately and `refresh`/`setData`/store-change/parent-update deliveries are ignored.
- A view restored after a failed navigation mid-leave fires the show bracket again (`viewWillShow()` → `viewDidShow()`, zero-duration, each hook contained) before its eventual real leave fires the full hide bracket.

**The hide bracket pairs with the mount.** Hide hooks and `out` fire only for a view that reached `mounted()`. A component removed while its first `data()` was pending is destroyed instantly: pending run cancelled, subscription dropped, `destroyed()` fires, no hide hooks. A view with a `<puzzle-skeleton>` (§16) **is** mounted once the skeleton renders, so it leaves with the full bracket.

**Route transitions** are sequential by default: after the new chain's `data()` resolves, the old view plays `out` and is destroyed, then, in one synchronous block with the new mount (§30), URL and title commit and the new view plays `in`. A navigation superseded or failed during the out commits nothing. The enter is fire-and-forget. Overlap is opt-in (§26). **One animator per transition:** a view swapped inside a reused layout animates alone; on a layout swap the layout animates and its view rides along.

## 16. Skeleton loading

A declarative loading template shown while a component's **first `data()`** is pending, then swapped for the real template ([[DECISION-D39-SKELETON]]). Presence-driven: no config, no API.

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

- At most **one** per file. The only allowed attribute is `min-duration`, a static unsigned integer in ms ([[DECISION-D52-SKELETON-ANTIFLASH]]); anything else, a dynamic value, or a malformed number is a compile error. In view mode the skeleton renders under the same `<puzzle-view>` root, so the swap patches children only.
- The body uses the full template grammar. **Only `created()`-seeded state is readable**; the model is not loaded yet.
- **Component mode:** a single **plain-element** root (a component root is a compile error); keep its tag equal to the template root's so the swap patches in place.
- Compiled to `Name.prototype.renderSkeleton` beside `render()`, with `skeletonMinDuration` beside it.

**Runtime.** A component is **loaded** once its first `data()` commits (`view.loaded`).
- **Async first `data()`** → the skeleton renders immediately, `mounted()` fires against it, and the mount does not wait on data; child enters play on the skeleton, and the real render patches over it (bracketed by `beforeUpdate`/`afterUpdate`) when data commits. All §61 settle rounds count as one load.
- **Synchronous `data()`** → the skeleton never appears.
- **`loaded` never resets**: later refreshes keep current content until new data commits. It is a first-load affordance, not a spinner.
- A `data()` rejection while the skeleton is up is **reported and the skeleton stays**: catch in `data()` and return an error model, or rely on §60.
- **`min-duration`** holds the swap until that long after the skeleton appeared; data arriving later swaps immediately. Refreshes during the hold update the pending model and one swap lands at expiry; destroy cancels the hold.

**Routing exemption.** A **fresh** routed view or layout with a skeleton does **not** gate the navigation commit on its `data()`: it mounts showing the skeleton and patches in later. Reused ancestors **always** gate; skeleton-less views keep await-then-commit. In sequential mode the URL still moves only after the outgoing `out` (§30). Traded guarantee: a skeleton view's failed load can leave the URL on a view still showing its skeleton.

**Rejected:** an error slot (`<puzzle-skeleton error>`: it could not read the error; errors live in the data model or §60); delay-before-show (it would render an empty root); skeletons on refresh/params-only navigations.

## 32. `this.memo()` — reference-stable derived values

`memo(key, deps, factory)` ([[DECISION-D64-MEMO-HELPER]]): a per-instance cache keyed by string. It returns the cached value while `deps` (an array) matches the previous call positionally by `Object.is` (a length change is a miss); otherwise it calls `factory()`, caches and returns the result. Synchronous, no reactivity of its own. It exists because props compare shallowly, so object props compare **by reference**:

```js
data(params, props) {
  const { effect = 'carousel' } = this.getData();
  return {
    carouselOptions: this.memo('opts', [effect], () => ({ effect, loop: true, slidesPerView: 2 })),
  };
}
```

This is the blessed pattern for object/array props: build in `data()`, wrap in `this.memo(...)` keyed by the ingredients. A prop expression cannot start with an object literal (D173), and a literal built in the template would be fresh each render anyway. A store record prop needs no memo: it also compares by render revision ([[FLOW-REACTIVITY]]).

## 34. App lifecycle hooks

Three optional PuzzleApp config functions ([[DECISION-D66-APP-LIFECYCLE-HOOKS]]), the home for app-level setup and teardown.

```js
const app = new PuzzleApp({
  target: '#app', routes, models,
  async beforeMount(app) { seedTasks.forEach((t) => app.store.createRecord('task', t)); },
  mounted(app) { window.addEventListener('beforeunload', persist); },
  beforeUnmount(app) { persist(); window.removeEventListener('beforeunload', persist); },
});
```

- **`beforeMount(app)`** runs inside `mount()` once services are wired (`app.store`, `app.router`, `app.formatters`, and `app.i18n` when configured), before navigation zero. **Awaited**, so seeding here reaches the first `data()`. A throw or rejection **aborts the mount**: the app tears back down, `mount()` rejects with that error, `beforeUnmount` does not fire, and re-mounting later is legal. An `unmount()` during an in-flight `beforeMount` wins; the router never starts. After it, `mount()` awaits the locale table when `i18n` is configured (a total load failure aborts the same way), then the dev state restore, then `router.start()`.
- A stale continuation, even one racing a newer `mount()`, cannot start the router, restore dev state, fire `mounted` twice, or tear down the newer cycle. A rejected `router.start()` (navigation zero failing its commit) aborts the same way; post-commit `render()`/`mounted()` failures are reported (§60) and do not reject.
- **`mounted(app)`** runs after the initial route rendered and dev state was restored. **Not awaited**; a throw or rejection is reported as `app-mount`.
- **`beforeUnmount(app)`** runs at the top of `unmount()` with services live, only when actually mounted (idempotent). Synchronous: a returned promise is not awaited and its rejection is reported; a throw is reported and teardown proceeds.
- Hooks receive the app (and `this` is the app for `function` form), re-fire every mount/unmount cycle, and a non-function non-nullish value throws at `mount()` before any wiring.
- A slow fetch belongs in view `data()` behind a skeleton, not in `beforeMount`, which delays navigation zero.
- Rejected: app-level `settings`/`computed`/`methods`, global events, the `$events` bus, `ctx.utils`, an app-config devtools hook.

## 37. Cross-view morphs

Elements sharing a `data-puzzle-morph` value morph between views with only `enableMorph(app)` from `@magic-spells/puzzle/morph` (base contract [[DECISION-D55-MORPH-TRANSITIONS]]; sibling swaps [[DECISION-D68-CROSS-VIEW-MORPH]]; roles [[DECISION-D69-MORPH-ROLES]]). The router is untouched: morph is one registered handler. Implementation: [[COMPONENT-MORPH]].

- **Live pairs.** When the counterpart is still on the page outside the entering view (a dialog over a list), the element flies there and flies back on close.
- **Sibling swaps.** At leave, morph elements in the outgoing view are snapshotted, and a recently clicked one is pinned in place as a clone while the old view fades. At enter, the first matching element in the new view receives a one-shot clone flight. A skeleton view's target may arrive at the skeleton → content swap. Captures last one navigation.
- **Directional roles.** Plain `data-puzzle-morph` launches and receives. `data-puzzle-morph-trigger` launches only; `data-puzzle-morph-target` receives only and is **preferred over a plain element** with the same id in the arriving view. Trigger → target pairs are forward-only (list → detail morphs, detail → list renders plainly): direction belongs to the element, not to history. With several triggers sharing an id, the clicked one launches, else document order; duplicate ids warn once. An `options.attribute` override (`data-x`) derives all three names (`data-x-trigger`, `data-x-target`).
- **Rules:** D55's element rules apply. A capture-flight target's view should use an opacity-only `in` (or none), since the landing rect is measured once. One flight per transition, one shared engine. Navigation zero and reduced motion never morph.

## 38. Element refs — `ref="name"` → `this.refs`

A static `ref="name"` on a **plain element** binds its live DOM node to `this.refs.name` ([[DECISION-D72-ELEMENT-REFS]]). The attribute is framework-owned (stripped from the DOM and from SSG output like `key`/`island`), and the name must be an identifier.

- `this.refs.name` is the mounted element, or `null`. It is populated **before `mounted()`**; a keyed or tag replacement re-points it; removal (`{#if}` off, row leaving, teardown) nulls it. Outside `mounted()`, guard with `?.`. `refs` is an instance field, never in `getData`/`setData` or dev state snapshots.
- Codegen emits `ref: this.__ref("name")`; `__ref` returns a per-instance **cached** setter whose guarded removal makes patch ordering irrelevant. `refs` and `__ref` are reserved names.
- **Positioned compile errors:** a dynamic `ref={ expr }` or interpolated value; empty or valueless `ref`; a non-identifier name; `ref` on a component (use an `@ready` callback prop), on a `<Slot>`, `<Children>` or `<Portal>` marker, or on the `<puzzle-view>` root (that is `this.element`); inside `{#for}` (no per-iteration refs); inside `<puzzle-skeleton>`; inside a `<Snippet>` body; duplicate names in one template.
- **`ref` + `island` (§17)** is the zero-diff animation path: `<svg island ref="scene">` plus a rAF loop in `mounted()`.

## 39. Scroll-triggered enter animations — `trigger: 'visible'`

An `in` spec accepts `trigger: 'mount' | 'visible'`, `triggerOffset` and `triggerAnchor` ([[DECISION-D73-SCROLL-TRIGGER-ANIMATIONS]]). Absent or `'mount'` is the normal enter. With `'visible'` the element is **held at its `from` keyframe** (a paused animation with `fill: 'both'`, so no flash) and plays **once**, the first time it enters the viewport.

```js
animations = {
  in: { from: { opacity: 0, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'translateY(0)' },
        duration: 500, easing: 'ease-out', trigger: 'visible', triggerOffset: '15%' },
};
```

- `triggerOffset` (px number or `'%'` string) sets a trigger line that far above the viewport bottom. An element already in view reveals at once.
- **`triggerAnchor: '<selector>'`** observes an **ancestor** (found once via `this.element.closest()`), so everything anchored to it reveals in the same frame (per-child `delay` choreographs). No match → warn once, observe the own root. Without `trigger: 'visible'` it warns once and is ignored. `{#for}` rows share one spec and so reveal together.
- **Lifecycle:** the `viewWillShow()` → `in` → `viewDidShow()` bracket defers as a unit to the reveal; `mounted()` timing is unchanged. At most one reveal per mount (a keyed remount re-reveals). Fill-release (§12) still applies.
- **Degradation lands on `'mount'` behavior, never stranded content:** no `IntersectionObserver` → play at mount; **reduced motion → no hold at all**; unknown `trigger` or malformed `triggerOffset` → warn once, fall back; a WAAPI throw → instant reveal; a throwing show hook inside the reveal is logged and never blocks it. `destroy()` before the reveal disarms and skips the hooks. A `trigger` on `out` warns once and is ignored.
- **Scope:** any PuzzleView; runtime-only (the compiler never parses `animations`). On prerendered pages, below-fold components hold and reveal once the interactive layer mounts (router takeover in hybrid, `mountStatic` in static).

## 46. FLIP keyed-reorder animation: the `flip` directive attribute

A keyed `{#for}` row root may declare `flip` (bare) or `flip={ flipOptions }` (an options object built in `data()`) to animate **retained** rows from their old position to their new one after keyed reconciliation moves them: First/Last/Invert/Play over the completed patch, so DOM order, accessibility order and hit-testing are already final ([[DECISION-D85-FLIP-ATTRIBUTE]]).

- A framework directive like `key`/`island`/`ref`: stripped from DOM attributes and SSG output.
- Translation only (no scaling); deltas under 0.5 px skip; a pre-existing base transform is composed under the correction and restored; animation state is fully released on settle.
- Defaults `250` ms, `cubic-bezier(0.2, 0, 0, 1)`; malformed options fall back to defaults; unknown keys are ignored.
- A rapid re-reorder measures the current **visual** rect (mid-flight transform included), cancels the prior Puzzle-owned FLIP (foreign animations untouched), and animates from there.
- Inserted rows take the enter path (§12/§39); leaving rows take the out path and are never FLIP candidates.
- Reduced motion or no Web Animations → no measurement at all. `flip` ships only when the usage scan sees it written in a template (§54), so write it directly on the row, not through a spread. A `flip` on an unkeyed row warns once.
- Author transform animations on the same element may conflict; a wrapper element is the escape hatch.

## 60. App-level error handling — `onError` + the app error view `errorView`

Two optional PuzzleApp config keys over the framework's failure recovery ([[DECISION-D145-ERROR-BOUNDARIES]]).

**The funnel** (`client-runtime/errors.js`). Every framework-contained error reports through one funnel. `onError(error, info)` receives a frozen `info = { phase, view, route }`. The twelve phases are `mount`, `refresh`, `render` (a scheduled `setData` re-render), `bind`, `enter`, `leave`, `unmount`, `navigation`, `transition`, `app-mount`, `app-unmount` and `error-view`; they are pinned in the type tests (`PuzzleErrorInfo`), so a new emission site cannot ship without its member. A loaded swap deferred by a skeleton hold reports `mount`, for a routed view too. `view`/`route` are `null` where the site has none; the app phases always carry `view: null`. With no hook, the funnel logs with `console.error`. A throwing or rejecting `onError` is caught and logged and never re-enters. **Not funneled:** rethrow-to-caller paths (`beforeMount`, `router.start()`), explicit verdicts (a guard returning `false`), input-capability fallbacks, event handlers.

**Only current-run failures report.** A refresh whose token moved, or whose view is destroyed or leaving, is discarded whether it fulfilled or rejected, and §61's settle loop drops a stale pass's rejection like its success. Discarded work never reaches `onError` or the error view.

**The error view.** `errorView` registers **one** ordinary compiled view (a non-constructor throws at construction). When a mount/refresh failure lands, the runtime reports, destroys the failed instance, and mounts a fresh error-view instance **at the exact failed position**: replacement, never re-render. Parent, siblings and layout keep their state. Props: `error` (as thrown), `info` (the same frozen object), `retry` (identity-stable for the error view's life).

**Retry** rebuilds through the position's normal owner. For a routed view/layout the router forces a same-location rebuild (constructor → `created()` → `data()` → render → mount). For a child component the placeholder stays and the parent's `refresh()` remounts a fresh child (props and slots re-derived). **A retry never blanks its position:** the routed face stays mounted until a successful commit disposes it, or a load failure swaps in a face with the new error and a fresh callback; any other pre-commit exit (guard block, no-op redirect, supersession) leaves the face with its old error. For a component, retry releases the position and the owner's re-render refills it; if the owner's `refresh()` itself rejects, the runtime refills the position with a new face and reports the owner's failure once as `refresh`. **Single-flight per press:** a concurrent second call is ignored, and the latch re-arms when the rebuild ends with the same face mounted. A replaced face's callback is spent; a retry after the position was removed is a no-op. Nothing retries automatically.

**Edges.** The error view failing reports once as `error-view` and stops (never an error view for the error view); the placeholder stays recoverable. A failed hybrid takeover renders the error view first, and restores the prerendered page only when none is configured or it also failed. Prerender-time failures fail the build; the error view never renders into HTML. Without `errorView`, failures still report and positions keep an invisible placeholder. There is no per-view error API (`errorContent`, boundary walk, `<ErrorBoundary>`).
