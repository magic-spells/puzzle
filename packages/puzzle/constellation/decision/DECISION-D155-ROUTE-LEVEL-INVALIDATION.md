---
name: D155 — route-level invalidation in static dev
status: verified
connections:
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D175-TRANSLATIONS
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-BUILD-WATCH
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - compiler/internal/build/route_deps.go
  - compiler/internal/build/watch_static.go
  - compiler/internal/build/prerender_pages.go
  - client-runtime/ssg/index.js
---

# D155 — route-level invalidation in static dev

## Context

After [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]] the node prerender, which
renders every route, is the largest phase of a static dev save regardless of
edit size. Skipping pages naively would renumber slugs and output-path claims,
which are assigned by walking the page list in order.

## Decision

A warm static rebuild renders only the routes the change can reach; every other
page is hardlinked from the serving tree into the new staging tree, so the swap
still publishes a complete site. Anything the classifier can't place, or a
partial render that can't complete, falls back to a full render. Output is
byte-identical to `puzzle build --static` either way. Logic:
`compiler/internal/build/route_deps.go` (`buildRouteGraph`, `renderWide`,
`classify`).

**Graph.** Two esbuild metafiles, captured from passes the build already runs:

- The per-page metafile, walked from each route's `mountStatic` entry, maps
  module → routes (ATTRIBUTABLE).
- The prerender metafile (rooted at the app entry) gives RENDER-WIDE modules:
  walk from in-degree-zero roots (the generated stdin root matches no file
  name) and never descend into a chain root — the view/layout modules the
  prerender summary reports per page, **including skipped routes** (dynamic
  without `staticPaths`, shadowed), else shared components under a skipped
  route go render-wide. A skipped route's missing `__pzlModule` stamp is
  dropped, not raised. Any walk failure (no chain roots, no roots, no inputs)
  marks the whole prerender graph render-wide.
- Known gap: a view imported directly by `app.js` is still a chain root, so its
  subtree stays page-attributed. Accepted.

**Classify** (a batch is its most conservative member):

1. No graph, empty change list → full.
2. The shell (`<public>/index.html`) → full. Anything under `app/locales/` →
   full (translations are render-wide and read from disk,
   [[DECISION-D175-TRANSLATIONS]]).
3. A public path in neither graph set → copy only, zero routes (even if
   deleted). A public path the graph knows is a module first and falls through.
   Public dir resolves via `publicDir(root)` (`app/public` or root `public/`).
4. A vanished path (delete/rename) → full.
5. **Render-wide checked first** → full. The sets overlap (a store seed
   `beforeMount` runs and one view imports); attributing it would leave other
   pages stale for the session.
6. Attributable → its routes.
7. A `{#svg}` asset (no metafile edge) → `CompileCache.AssetConsumers`, then the
   same rules on each consumer.
8. `.css` → no render (always composed into `styles.css`).
9. Anything else → full.

**Subset render.** `prerenderToDir` takes an `only` filter, passed as node
`argv[4]` (the entry source is held by a persistent esbuild context). Every
route is still enumerated and claims its slug/output path; skipped ones are
reported `reused: true` with no context built, so `beforeMount`/`data()` don't
run for them. An empty subset (public-asset save) builds no context at all.
The one-shot build passes no filter.

**Reuse and fallback.** Reused pages are hardlinked (byte copy if the
filesystem refuses) — safe because prerendered pages are only ever replaced
wholesale by a swap. A partial render that can't finish (no last-good page, an
unencodable filter) restarts as a full render inside the same `Rebuild`. A
compile error is not a fallback trigger.

**Commit only on success.** The captured graph, route count and cleared
`pending` change set install only after the staging swap succeeds; a failed
compile, render or swap re-classifies every accumulated path next save.

The per-page esbuild pass still bundles every route (content-hashed chunks must
stay consistent); only the render is skipped. Path resolution
(`EvalSymlinks`) is memoized per process.

## Alternatives

- Render-wide = prerender graph minus page graphs — a module in both
  subtracts out and other pages go stale.
- Cut the walk at `routes.js` — the Go build can't name it; chain roots are
  reported exactly.
- Diff rendered HTML — still renders everything.
- Skip in the writer — `data()`/`beforeMount` already ran.
- Attribute by path convention — wrong for shared components.
- Cache the prerender summary in Go for zero-route changes — a second, weaker
  classifier.
- Persistent node render worker — deferred (module invalidation, global state).

## Consequences

- `PUZZLE_PROFILE_BUILD=1` shows `route classify`, `route graph`, and on a
  partial `partial render (N/M routes)` and `page reuse (N/M)`, so a silent
  degradation to full render is visible.
- Reuse costs one filesystem op per unrendered page.
- The equivalence test asserts each step's classification as well as byte
  identity with a one-shot build, including a component shared by a rendered
  and a skipped route.
