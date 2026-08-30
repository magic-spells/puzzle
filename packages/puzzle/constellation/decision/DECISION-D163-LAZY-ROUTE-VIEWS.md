---
name: 'D163 — Lazy route views: the branded lazy() marker, resolved after guards (v1.77)'
status: built
connections:
  - FEATURE-SPA-CODE-SPLITTING
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
notes:
  - kind: verified
    text: >-
      Card written against the merged implementation on feat/lazy-route-views and verified by
      reading it: vitest 1882/1882 green (including 10 router-lazy tests — memoization, shared
      in-flight, shared REJECTING in-flight, guards-before-download, nested parallel chain,
      catch-all, namespace-without-default, bare-function rejection), tsc -p tests-types clean, and
      go test ./... green including the three new build tests (splitting on emits a chunk / off
      inlines / static prerenders + bundles the resolved class). Measured cost: +0.9 KB gzip
      hello-world and +0.8 KB todos against release/0.7.0 — the README banner (20.6 / 23.6) is stale
      and release:prep will fail on it. Byte-neutral for static pages after the review moved the
      resolver out of ssg/assemble.js; the pre-review version cost ~537 B gzip on EVERY static page
      bundle for machinery that mode can never run.
---

A route's `view` or `layout` can be a **loader** instead of a class, so that
class downloads on first navigation to the route rather than riding in the
initial bundle. D160 shipped splitting as a *dependency*-level tool — you split
what you `import()` yourself — and named this as its phase 2. This card owns the
route-level question: what the authoring surface is, when the download starts,
and what a failed download does to the navigation.

```js
// app/routes.js
import { lazy } from '@magic-spells/puzzle';

export default [
  { path: '/', view: HomeView, layout: DefaultLayout },
  { path: '/settings', view: lazy(() => import('./views/settings/Settings.pzl')),
    layout: DefaultLayout, children: [
      { path: '', view: lazy(() => import('./views/settings/General.pzl')) },
    ] },
];
```

## The marker is branded, and a bare function is an error

`lazy(loader)` returns a frozen empty object registered in a module-level
WeakMap. Nothing about that object is inspectable and nothing else can forge it
— `isLazyView` is a WeakMap membership test, not a shape test. The Router
accepts a view/layout position that is a `PuzzleView` subclass or a marker, and
rejects everything else while the route table compiles, with a message naming
the position.

A **bare function** gets its own message steering to `lazy()`. Puzzle
deliberately does not sniff whether a function is a class or a loader: both are
functions, both are plausible in that position, and a wrong guess is a route
that silently renders the wrong thing. This is D159's posture applied one level
down — there, a `routerMode` string throws and names the import rather than
being interpreted; here a loader function throws and names `lazy()`.

Validating every view position is new, and it is a tightening: a value that is
not a `PuzzleView` subclass used to fail later, at construction on first
navigation. It now fails from the `Router` constructor. That is the same
fail-fast posture the path/layout/guard/transition-mode validators already
have, and it runs *after* them so the older diagnostics keep their precedence.

## Resolution happens after guards, before construction

The load phase runs markers in `#navigate` at exactly one point: after every
inherited guard has allowed the navigation (D87), and before the reuse
calculation, any view/layout constructor, or any `data()`. Two consequences are
the point of that placement:

- **A blocked or redirected route never downloads.** An entry guard that
  refuses `/admin` costs no bytes. Putting resolution before guards would leak
  the existence and the code of a gated route to anyone who can type its URL.
- **The reuse calculation sees resolved classes.** Layout reuse compares the
  resolved class against the committed one, so a lazy layout that resolves to
  the same class as the current one is still reused rather than rebuilt.

All markers in one matched chain — every level's view plus the top-level layout
— start before anything is awaited, then resolve through one `Promise.all`. A
nested `/settings` shell and its index pane load concurrently, not in chain
order.

## A failed load is a failed push, and retry re-invokes

Loader rejection is bracketed by load-then-commit exactly like a `data()`
failure (D19/D61): it happens before any fresh instance exists, so the URL,
history, and mounted tree are untouched and the user simply stays where they
are. It reports through `onError` as the existing **`navigation`** phase — no
new phase — so `errorView` and its retry work with no special case, and retry
re-enters the ordinary same-location rebuild (D145).

Memoization is deliberately **asymmetric**:

- **Fulfillment is cached for the marker's lifetime** (the app's, in practice —
  markers live in the route table). A second visit costs nothing.
- **Rejection is never cached.** The in-flight slot is cleared by the settle
  handlers *before* any consumer of the shared promise observes the outcome, so
  a retry after a failed chunk fetch always reaches the loader again. This is
  the difference between "the network blipped once" and "this route is broken
  for the rest of the session."
- **Concurrent navigations share the in-flight promise.** Two routes can hold
  the same marker; two navigations racing to it issue one import.

## No loading UI, on purpose

There is no new spinner, skeleton hook, or fallback slot. The previous view
stays mounted until the incoming one commits — the same thing a slow `data()`
already does, and the same reason the D39 skeleton story does not extend here
(a skeleton cannot render before its own module arrives). Route-level loading UI
would need a design of its own; the answer for v1 is that a lazy route behaves
like a slow route.

## Build and prerender interplay



`build.splitting: true` (D160) turns each loader's `import()` into a chunk under
`dist/chunks/` through machinery that needed no changes. With splitting off,
esbuild inlines the import and `lazy()` still works — same semantics, one fewer
request. `examples/blog` splits its whole `/settings` section this way and is
built by the test suite's `pretest`.

Both prerender modes await the same markers: the DOM-free chain assembly is
handed the resolved classes by the Node pass, and static-mode per-page module
collection reads `__pzlModule` off the **resolved** class, so a lazily
referenced view lands in its page bundle like any eager one. Static output
therefore has no runtime laziness at all, which is correct: those pages have no
router and their kernel zips real classes onto the page's route JSON.

Cost containment is part of the decision, at two levels.

Per navigation: an app with no `lazy()` anywhere allocates nothing and adds no
microtask, because each entry's class list is settled once, when the route table
compiles.

Per bundle: an app with no `lazy()` anywhere does not ship the resolver at all.
`router/lazy.js` sits behind the `__PUZZLE_HAS_LAZY__` define
([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]), which the build's usage scan sets
false when no first-party source calls `lazy()` — worth ~0.6 KB gzip on a
lazy-free SPA, which is most of what the feature costs. Two structural
consequences follow and must be preserved by anything that touches this module:

- **`validateRouteView` lives in `router.js`, not here.** Route-view validation
  runs in every app, so a call into `lazy.js` for it would pin the module into
  every bundle. The class-shape helpers the two share (`isViewClass`,
  `describeValue`) live in `router/viewClass.js` so neither module imports the
  other.
- **A marker that reaches a compiled-out build fails loudly.** The scan does not
  read `node_modules`, so a package that builds route tables could hand an app a
  marker the build never saw. With the define false, `isLazyView` is folded away
  and the marker falls through to `validateRouteView`'s throw, whose message
  then names the compiled-out gate. It is never mistaken for a view class.

The resolver is kept out of `ssg/assemble.js` for a related reason: that module
is shared with the static browser kernel, which can never see a marker, and
importing it there put ~500 B gzip of dead machinery in every static page
bundle.

## Alternatives rejected

- **Detect a bare function as a loader** (`view: () => import('./X.pzl')`, the
  spelling D160's card sketched). A class and a loader are both functions, and
  the only distinguishing signals — a `prototype` chain, `toString()` shape —
  are heuristics that a minifier or a transpiled class can defeat. Guessing
  wrong routes the app somewhere the author did not ask for. An explicit marker
  costs one import and removes the question.
- **A separate `lazyView:` route field.** Two fields for one position invites
  both being set and needs a precedence rule; the marker keeps one field with a
  widened type, and the type system rejects the bare-function spelling.
- **Splitting on by default now that routes can be lazy.** Still D160's answer:
  `dist/` shape is a deployment concern, and the default flip should be its own
  boring change. `lazy()` is useful with splitting off — it is the authoring
  seam; splitting is the packaging switch.
- **A loading view / route-level suspense.** See above: the previous view holds.
  Adding a fallback surface here would fork the D39 skeleton story into two
  loading systems before anyone has asked for the second.
- **Resolving markers before guards, to overlap the download with guard work.**
  It would shave latency on allowed navigations and leak gated code on refused
  ones. Guards exist to be the first thing that runs.
- **Caching rejections with a manual invalidation API.** More surface, and it
  makes the common case (a transient fetch failure, the user presses retry)
  the one that needs extra code.
