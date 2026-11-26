---
name: 'D195 — Link prefetch: lazy route code loads on intent, guarded routes only on request'
status: verified
connections:
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - DECISION-D196-NAMED-ROUTES
verified_at: '2026-11-24T18:05:31.213Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

## Context

D163 made route views lazy: a `lazy()` section downloads on first navigation, and the previous view stays up while it does. On a slow link that is a visible pause after every first click into a section. The user almost always signals the click before it happens — the pointer rests on the link, a finger lands, focus arrives — and that window is usually long enough to fetch a small chunk. DOC-SPEC's deferred list named "link preloading" as the follow-up. This card owns when that download starts, what it may load, and how authors turn it off.

## Decision

**Code only, through the navigation resolver.** Prefetch matches the link's path and calls `resolveRouteViews(entry)` — the same memoized resolver `#navigate` uses. No guard, constructor, `data()`, history or tree change. Dedupe is free: D163's memo shares an in-flight load and caches a fulfilled one; a rejection is not cached, so a failed prefetch is silent and the click retries and reports as a D163 failed push. Data prefetch is out of scope until route data has a server story.

**Intent, on by default.** Document-level passive listeners: `pointerover` arms a 60 ms timer for mouse and pen (cancelled by `pointerout` unless the pointer moved to one of the link's own children); `pointerType === 'touch'` and `focusin` load at once. Default-on because the cost is bounded (a chunk the user is about to ask for) and the win is in exactly the apps that chose `lazy()`.

**Per link: `data-prefetch`.** Absent → the app default; `""`/`"intent"` → intent; `"visible"` → intent plus once on scroll into view; `"off"` → never; anything else warns in development and means intent. A plain attribute fits how links already opt out of interception (`target`, `download`) and works in any template or raw HTML with no compiler support.

**App-wide: config `prefetch`** (boolean, default `true`), passed to the Router as its `prefetch` option. `false` turns off the default only; a link that names a mode still prefetches. A non-boolean throws at startup — `'hover'` reads like a mode Puzzle does not have.

**Guards stay closed by default.** D163's rule is that gated code never downloads on its own. The app default skips a matched entry whose (inherited) guard list is non-empty. A link that names a mode, and `router.prefetch()`, load it anyway — the author has said the code is not secret. Guards never run during prefetch: they can have side effects and are written for a real navigation.

**`router.prefetch(target) → Promise<boolean>`** for programmatic warming (after login, on idle). The target is a path or a named target ([[DECISION-D196-NAMED-ROUTES]]), resolved by the same `targetPath` as `push()`, so a bad one throws synchronously. Explicit, so it skips the guard rule and the connection check; never rejects; `true` means the code is in memory or there was nothing to load.

**Respect the connection.** Automatic prefetch does nothing under `navigator.connection.saveData` or a 2g-class `effectiveType`. The chunk still loads on click.

**Same link test as the click.** `#handleClick` was split so `#linkPath(a)` answers "which in-app path would a click on this link navigate to" (target, download, mailto/tel, origin, base, locale prefix, and the mode seams). Prefetch and interception share it, so a link never prefetches where a click would not navigate. The D159 mode seams `fragmentPath(fragment, base)` and `linkPath(url, base)` are pure: they return a path or null, and the caller pushes or prefetches.

**Visible.** A `MutationObserver` on the document re-scans for `a[data-prefetch="visible"]` after each batch of DOM changes, observes new ones through the shared `observeVisible` registry (D73's scroll-trigger registry, already in every bundle with views), disarms disconnected ones, and observes each link once. Skipped where `IntersectionObserver` or `MutationObserver` is missing.

**Cost containment (preserve these):**
- `router/prefetch.js` is imported by `router.js` but every call sits behind the D89 `__PUZZLE_HAS_LAZY__` probe, so an app with no `lazy()` drops the module, the option passthrough in `app.js`, and the validation. What remains is `router.prefetch()` and the `#linkPath` split (~60 B gzip).
- Per-router state lives in a module `WeakMap`, not router fields, for the same reason; the Router reads the option off `arguments[1]` because esbuild keeps an unused destructured key.
- Listeners are added at `start()` only when some route entry (or the catch-all) has a marker, and one `AbortController` removes them at `stop()`.

## Alternatives

- **A bare `prefetch` attribute** — not a standard attribute on `<a>`; `data-` keeps the markup valid HTML and plainly app-owned.
- **Opt-in only** — leaves every `lazy()` app with the pause it adopted `lazy()` to manage; the people who want it off are fewer and have two switches.
- **`visible` by default** — on a list page it downloads every section linked from the page, which defeats splitting.
- **Prefetching guarded routes by default** — breaks D163's "a blocked route never downloads".
- **Running guards during prefetch** — guards may redirect, read the store, or have side effects; a prefetch is not a navigation.
- **`<link rel="modulepreload">` injection** — needs the chunk URL, which only the bundler's output knows; calling the loader lets esbuild's own `import()` find it and dedupes with navigation for free.
- **Per-element listeners attached by the compiler** — more code per link and a compiler change for a runtime-only concern; one set of document listeners covers raw HTML and pieces too.
- **Mode seams that push on their own** — prefetch would need a second copy of the hash and memory link rules.
- **Prefetching `data()`** — waits on server-side data work; `data()` today may read the store with side effects.

## Consequences

- A lazy app's first click into a section is usually warm; the bundle with markers grows by roughly 0.75 KB gzip.
- Static output (D81) has no router, so no prefetch; hybrid pages get it once the SPA router starts.
- Tests: `tests/router-prefetch.test.js`.
