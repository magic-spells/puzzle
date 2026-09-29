---
name: Prerender flow
status: verified
triggers:
  - kind: manual
connections:
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - FILE-SSG-RUNTIME
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-SERIALIZER
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-HEAD-TAGS
  - DECISION-D01-SPA-ONLY
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - DECISION-D142-HYBRID-ROUTE-SNAPSHOT
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D161-AUTO-FETCHING-FINDS
  - FLOW-BUILD
  - DOC-SPEC-BUILD
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Prerender flow

The two prerender modes on top of the SPA build ([[FLOW-BUILD]]): `hybrid` (prerendered
HTML + the SPA bundle, which takes over at navigation zero,
[[DECISION-D67-SSG-STATIC-BUILD]]) and `static` (true static pages with a per-page mount
module, [[DECISION-D81-STATIC-PAGES-MODE]]). Neither is SSR or hydration
([[DECISION-D01-SPA-ONLY]]): the runtime clears the prerendered children and mounts a
freshly rendered tree in one synchronous swap — it adopts the *screen*, not the nodes.
Runtime detail is [[COMPONENT-SSG]].

## Build time

1. **Resolve the output mode** before bundling: a `--static`/`--hybrid` flag that disagrees
   with `output` is a hard error. A plain SPA build warns per `routes.js|.ts` that sets
   `meta.description`/`canonical`/`socialImage` (tags only exist at prerender time).
2. **Prerender after the shell and public assets are in staging, before the swap** — the
   shell is the injection template; a failure must leave the last good `dist/`.
3. **Go generates a Node entry, bundles it, runs it — Go never renders.** The summary
   follows the LAST stdout sentinel (user logging is harmless). Missing `node`, non-zero
   exit, timeout or missing sentinel fail the build with stderr surfaced.
4. **One unstarted memory Router per build** enumerates one entry per leaf; the
   prerenderer compiles no matchers of its own, so it can't disagree with the live router
   on path shape ([[DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP]]).
5. **Assemble each chain without a DOM** via `assembleChain` (created + awaited `data()`,
   no `mounted()`, no animations; layout last), shared verbatim with the static kernel.
6. **Serialize** mirroring ViewManager (inline components, shared slot expansion,
   controlled state as attributes, directives dropped, placeholders and Portals → nothing,
   RAWTEXT script/style per [[DECISION-D113-SSG-RAWTEXT-RULE]]).
7. **Splice into the shell** against a plan of byte offsets compiled once per build
   ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]).
8. **Emit per mode**: hybrid writes `<path>/index.html` (catch-all → `404.html`) with a
   marked container; `prerender: false` gets the untouched shell. Static strips the
   `app.js` tag, marks the target, and appends in one splice the data island, the D161
   read-state island (only if something settled, [[DECISION-D161-AUTO-FETCHING-FINDS]])
   and the page's module script. Slugs are assigned by walking the page list in order.
9. **Go post-checks**: a route page may not overwrite a `public/` asset (case-folded; only
   `/` writing the shell over itself is sanctioned); the scratch dir is reserved, then
   removed.
10. **Static only**: a browser-platform pass bundles the per-page entries with splitting;
    `app.js` and its map are deleted.
11. **Swap** staging over `dist/` atomically.

## Load time

**Hybrid** — the ordinary SPA bundle built with the takeover define
([[DECISION-D130-TAKEOVER-BUILD-DEFINE]]): the router navigates the real URL; for a marked
container it awaits the initial preload (no skeleton over real content), preloads nested
components with enters suppressed, then snapshots the prerendered nodes + marker, clears
and mounts. On rejection the error view gets the position first
([[DECISION-D145-ERROR-BOUNDARIES]]); otherwise nodes AND marker are restored
([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]) so a later mount can take over again. The
define is probed inline at each branch — hoisting it into a module constant silently
breaks the fold.

**Static** — `mountStatic`: resolve the target (missing throws); rebuild the chain from the
view classes and the serialized snapshot; build ctx with the THROWING router stub (history
hrefs regardless of `routerMode`); `beforeMount` is not called (it ran at build time);
rehydrate the data island (replace mode), then the read-state island (records first);
assemble through the same module (so `data()` against the rehydrated store matches the
markup); suppress enters, snapshot, clear, mount into the CONNECTED container (`mounted()`
may focus/measure); on rejection destroy and restore — the only recovery a static page
has. An unmarked (`prerender: false`) target mounts normally. Navigation is plain `<a>`.

**What each embeds**: hybrid embeds nothing — the route snapshot is shadowed onto the
build Router's `current` only while rendering ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]), and
no read state transfers. Static embeds the store snapshot and the read-state envelope as
HTML islands and the route snapshot as JSON in the per-page module.

## Head

Build-time only ([[DECISION-D84-HEAD-MANAGEMENT]]): fields resolve leaf → root with null
suppression; a resolving field replaces its first same-identity marker, duplicates
collapse, unresolved fields' markers are removed, unmarked fields append before
`</head>`. The splice can't reach past `</head>`, so view output is never touched. No
`</head>` degrades to "through the first `</title>`"; neither anchor → warn and skip.

## Skipped vs. failing

- **Skipped with a warning**: dynamic `:param` routes; leaves under a catch-all; in hybrid,
  routes shadowed by an earlier first-match pattern; no catch-all warns there is no
  `404.html`. A `:`/`*` inside a larger segment is literal and prerenders.
- **Build failures**: target not a `#id`, missing or non-empty; hybrid + any `routerMode`;
  any route's `data()` rejecting (including an unsatisfiable tracked fault), named by
  route; a path escaping the output dir; a RAWTEXT breakout; a `public/` collision; static
  only — a rendered route whose class lacks a compiled module stamp.
- **Warn-only**: a guarded hybrid route still ships its markup (a guard isn't a secrecy
  boundary; use `prerender: false`); static drops guards, `routerMode`, `storage` and
  function-shaped config.

## Invariants that break silently

- The hybrid and static markers are NOT interchangeable (double mount or no takeover, no
  error).
- Hybrid HTML under a plain-SPA bundle appends instead of replacing (the folded clear is
  empty) — each mode ships its own bundle with its own HTML.
- Slug assignment precedes any reuse decision; a subset render still enumerates and claims
  every page.
- A catch-all's children must not consume a compiled-entry index (one phantom index
  inverts the shadow skip).
- Two routes writing one file: hybrid lets the last claimant's HTML win; static keeps the
  first in reachable order and warns.
- Non-routed nested components see a null route at build time, as in the browser.
- The snapshot path is normalized in exactly one place (else non-ASCII paths differ
  between prerender and takeover).
- `prerender: false`: hybrid writes the untouched shell; static writes an unmarked target
  but still builds the page context, so `beforeMount` runs and its store becomes the
  island.
- Portal and placeholder content is invisible to crawlers in both modes.
