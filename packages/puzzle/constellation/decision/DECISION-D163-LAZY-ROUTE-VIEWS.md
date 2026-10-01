---
name: 'D163 — Lazy route views: the branded lazy() marker, resolved after guards'
status: built
connections:
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D81-STATIC-PAGES-MODE
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-RELEASE-SURFACE
  - RELEASE-V0-7-0
---

## Context

D160 splits what app code `import()`s itself. Route views are the other natural split point: a section's classes should download on first navigation, not ride in the initial bundle. This card owns the authoring surface, when the download starts, and what a failed download does.

## Decision

A route's `view` or `layout` may be a `lazy()` marker:

```js
import { lazy } from '@magic-spells/puzzle';
export default [
  { path: '/settings', view: lazy(() => import('./views/settings/Settings.pzl')), layout: DefaultLayout,
    children: [{ path: '', view: lazy(() => import('./views/settings/General.pzl')) }] },
];
```

**Branded marker; a bare function is an error.** `lazy(loader)` returns a frozen empty object registered in a module WeakMap; `isLazyView` is a membership test, so markers can't be forged. The Router accepts a `PuzzleView` subclass or a marker in every view/layout position and rejects anything else while the route table compiles (after the older path/layout/guard/transition-mode validators, so their diagnostics keep precedence). A bare function gets its own message steering to `lazy()` — Puzzle never guesses class vs loader.

**Resolution runs after guards, before construction.** In `#navigate`, markers resolve after every inherited D87 guard allows the navigation and before the reuse calculation, any constructor, or any `data()`:
- A blocked or redirected route never downloads (no leaking gated code).
- Reuse compares resolved classes, so a lazy layout resolving to the current class is reused.
- Every marker in the matched chain (each level's view plus the top-level layout) starts before anything is awaited, then resolves through one `Promise.all`.

**A failed load is a failed push.** It happens before any fresh instance exists (D19/D61), so URL, history and tree are untouched. It reports through `onError` as the existing `navigation` phase; `errorView` retry re-enters the ordinary same-location rebuild (D145).

**Asymmetric memoization:** fulfillment is cached for the marker's lifetime; rejection is never cached (the in-flight slot clears before any consumer sees the outcome, so retry reaches the loader again); concurrent navigations share one in-flight promise. Config-time errors are plain `Error`s; load-time failures are `TypeError`s.

**No loading UI.** The previous view stays mounted until the incoming one commits — a lazy route behaves like a slow route.

**Build and prerender.** With `build.splitting: true` (D160) each loader becomes a chunk under `dist/chunks/`; with it off esbuild inlines the import and `lazy()` still works. `examples/blog` splits its `/settings` section this way. Both prerender modes await the markers; static per-page module collection reads `__pzlModule` off the resolved class, so static output has no runtime laziness.

**Cost containment (preserve these):**
- Per navigation: an entry with no markers stays synchronous — no allocation, no microtask; a warm lazy route is synchronous too.
- Per bundle: `router/lazy.js` sits behind the D89 `__PUZZLE_HAS_LAZY__` define, false when no first-party source calls `lazy()`. So `validateRouteView` lives in `router.js`, and the shared `isViewClass`/`describeValue` live in `router/viewClass.js`, so neither module imports the other.
- A marker reaching a compiled-out build (the scan skips `node_modules`) falls through to `validateRouteView`'s throw, which names the gate — never mistaken for a class.
- The resolver stays out of `ssg/assemble.js`, which is shared with the static browser kernel; only the Node prerender resolves markers and hands the classes in.

## Alternatives

- Detecting a bare function as a loader — class-vs-function heuristics break under minifiers and transpiled classes.
- A separate `lazyView:` field — two fields for one position need a precedence rule.
- Splitting on by default — `dist/` shape is a deployment concern (D160); `lazy()` is the authoring seam, splitting the packaging switch.
- Route-level loading view / suspense — would fork the D39 skeleton story into two loading systems.
- Resolving before guards to overlap the download — leaks gated code on refused navigations.
- Caching rejections with a manual invalidation API — makes the common transient-failure retry need extra code.

## Consequences

Route validation is stricter: a non-view value fails at `Router` construction, not first navigation.
