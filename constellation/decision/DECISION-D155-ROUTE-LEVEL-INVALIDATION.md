---
name: D155 — route-level invalidation in static dev
status: verified
connections:
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-BUILD-WATCH
verified_at: '2026-08-13T04:52:53.633Z'
verified_sha: e76df0fd873bd4739a754d9861197a9f24074a5f
notes:
  - kind: verified
    text: >-
      Public-asset and empty-subset contracts re-scoped and verified against the classifier: an
      imported public module is attributed to its pages, a render-wide one forces a full render, a
      deleted one forces a full render, and only a path in neither graph set is copy-only.
    sha: e76df0fd873bd4739a754d9861197a9f24074a5f
---

# D155 — route-level invalidation in static dev

A warm static rebuild renders only the routes the save can reach. Every other
page is hardlinked out of the tree currently being served into the new staging
tree, so the swap still publishes a complete site. Classification that cannot
place a change falls back to a full render, and so does a partial render that
cannot complete — the output is byte-for-byte what `puzzle build --static`
produces either way.

## Context

D154 made every phase of a static dev rebuild warm except the one that had
become the largest: the node prerender, which starts a fresh process and renders
EVERY route regardless of what changed. On the reference site (262 `.pzl`, 148
routes) that phase alone was 855-894ms of a 1.31s save. Nothing about it scaled
with the size of the edit — a one-word change in a leaf view cost exactly what a
change to the route table cost.

The render is not obviously divisible, though. Slugs, output-path claims and
duplicate detection are all assigned by walking the page list in order, so a
render that simply skipped pages would renumber `_puzzle/<slug>.js` under pages
nobody touched. And the question the split turns on — which pages can this file
change? — is not one the compiler had ever had to answer.

## Decision

**Two esbuild metafiles are the dependency graph.** The per-page pass's
metafile, walked from each route's generated `mountStatic` entry, gives
module → the routes whose chain contains it: a file in that set is
ATTRIBUTABLE, and only its routes can differ. The prerender bundle's metafile is
rooted at `app/app.js` and therefore holds everything the render reads that no
single page owns — `routes.js`, the models registry, the formatters module,
`beforeMount` and the rest of the app entry. A file in that graph and in no
page's graph is RENDER-WIDE: it can move the store seed or the route table, and
every page's markup and data island with it. Both are captured after each
rebuild that produces them, from the same passes the build already runs.

**The classifier only ever narrows on evidence.** A batch is the most
conservative of its members. An unknown file, a vanished file (a delete or a
rename), an empty change list and a graph that was never captured are all full
renders. The two paths that need no render at all are named explicitly: an
UNIMPORTED public asset other than the shell is copied into staging verbatim and
appears in no page's HTML, and a standalone stylesheet is composed into
`styles.css` whatever happens (a Tailwind output change takes the same
zero-route path through `RecomposeStyles` — D154). The classifier resolves the
public dir and shell through the same `publicDir(root)` fallback the build uses,
so a root-level `public/` project gets the identical fast paths as `app/public`.
The shell itself (`public/index.html`) is spliced into every page and is
therefore always a full render.

**`public/` is inside the module resolve tree, so living there is not what makes
a file an asset.** A view or `app.js` can `import` a module that happens to sit
under `public/`, and the SPA watcher already counts one as a bundle input rather
than a public-only change. A public path the last committed graph knows about is
therefore a module first and an asset second: it is attributed to its pages,
forces a full render when only the prerender graph reaches it, and forces one
when it disappears. Only a path in neither graph set takes the copy-only
zero-route path — deleted or not, since a copy that no longer happens still
needs no render. Skipping the graph for everything under the prefix let a page
bundle rebuild around markup nobody re-rendered, which is precisely the
disagreement between a warm `dist/` and a clean `--static` build this card
exists to prevent. `{#svg}` needs no say in that branch: the asset resolver
refuses any path outside `app/assets/`, so an inlined-asset edge can never
start under `public/`.

**`{#svg}` is the one edge no metafile carries.** An inlined asset is a codegen
watch file, not a module input, so the compile cache — which already tracks the
edge in the eviction direction — exposes asset → consuming `.pzl` files, and the
classifier attributes those.

**The subset render keeps the page list whole.** `prerenderToDir` takes an
`only` filter; every route outside it is still enumerated, still consumes its
output-path claim and its slug, and is still reported in `written`, flagged
`reused`. No context is built for it, so `beforeMount` and `data()` never run on
its behalf and no file is written. Only the writes differ between a subset
render and a full one, which is what makes every order-dependent decision land
identically. An EMPTY subset is the limit case and behaves like one: it is what
a public-asset save produces, it renders nothing, and it builds no context at
all — the zero-page `beforeMount` fail-fast applies to a full render, where no
filter was given, so a no-op rebuild never runs application setup. The filter
rides on the node process's `argv[4]` rather than in the generated entry's
source, because the dev builder holds one persistent esbuild context over
exactly those bytes.

**Reused pages are hardlinked, not re-rendered and not copied.** D154 rejected
hardlinking `dist/` because esbuild rewrites its output files in place — but a
prerendered page is not an esbuild output. It is written once by the node pass
and then only ever replaced wholesale by the next staging swap, which unlinks
the old tree and leaves the new link owning the inode. A byte copy is the
fallback where the filesystem refuses a link.

**Falling back is transparent and complete.** A partial render that cannot
finish — a page with no last-good copy to link, an unencodable filter — restarts
as a full render inside the same `Rebuild` call. A compile error is deliberately
NOT a fallback trigger: it is the same error a full render would produce, and
retrying it would only double the time to the diagnostic. The one-shot
production build passes no filter and is untouched.

**Change paths accumulate until a rebuild lands.** The graph and the pending
set commit only after the staging swap succeeds: the rebuild parks its captured
graph, and `Rebuild` installs it, promotes the route count, and clears
`pending` once the new tree is serving. A failed compile, render, or swap
leaves both describing the pre-edit state, so every accumulated path is
classified again on the next save. Anything less and an import added during a
broken save would never be accounted for — or a swap that failed after a
successful render would strand the serving tree's stale pages as "last-good"
with the builder believing their changes landed.

**The per-page esbuild pass still bundles everything.** It is ~130-175ms warm,
its content-hashed chunks have to stay consistent across the whole route set,
and pruning it would buy little. Only the RENDER is skipped.

## Consequences

- Measured on a generated 148-route site with docs-shaped pages: 448ms → 388ms
  per leaf save, the render phase falling 195ms → 127ms. The gap understates the
  win on real content — that fixture renders a page in ~0.9ms against the
  reference deployment's ~5.8ms, so most of its render phase is node startup and
  bundle load, which a subset render cannot avoid.
- On the reference site the arithmetic is 855ms of render becoming roughly node
  startup + one page: a save lands near 400-500ms instead of 1.31s.
- `PUZZLE_PROFILE_BUILD=1` gains `route classify`, `route graph`, and — on a
  partial — `partial render (N/M routes)` and `page reuse (N/M)`, so a rebuild
  that silently degraded to a full render is visible rather than merely slow.
- Path resolution is memoized for the process. Building the graph resolves every
  metafile input and every import edge, and `EvalSymlinks` costs a stat per path
  component; unmemoized it made graph construction the single most expensive
  phase of a warm rebuild (~60ms, now ~9ms).
- The floor on the reuse phase is one filesystem operation per unrendered page —
  ~40ms for 148 pages on APFS, even hardlinked and even with sixteen workers.
  It is noise against a real render and dominant against a trivial one.
- The equivalence test asserts the CLASSIFICATION of every step as well as
  byte-identity with a one-shot build, so a partial path that quietly degraded
  would fail rather than pass for free.

## Alternatives rejected

**Diff the rendered HTML and keep what matches.** Renders everything to discover
that most of it was unnecessary — it buys the writes, not the render, which is
the expensive half.

**Skip pages inside the writer instead of the renderer.** Simpler, and useless:
`data()` and `beforeMount` have already run by then, which is where the time
goes.

**Attribute by route-path convention (a view under `app/views/docs/` owns
`/docs/*`).** Needs no metafile and is wrong the first time a component is
shared across sections — exactly the case a docs site is made of.

**Cache the prerender summary in Go and skip the node process entirely for a
zero-route change.** Tempting for a public-asset save, and it makes the compiler
responsible for deciding when a summary is still valid — a second, weaker copy
of the classifier with none of the metafile evidence behind it. The node process
runs on every rebuild; a zero-route filter just makes it cheap.

**A persistent node render worker.** Still the biggest remaining lever, and
still out of scope: it means owning module invalidation inside a long-lived node
process and reasoning about app-level global state surviving between renders.
Route-level invalidation is what makes the process's startup cost the floor
rather than a rounding error, so the two compose rather than compete.
