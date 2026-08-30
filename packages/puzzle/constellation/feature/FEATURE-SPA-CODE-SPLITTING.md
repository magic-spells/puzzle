---
name: "SPA code splitting (lazy chunks for dynamic import())"
status: verified
connections:
  - FILE-BUILD-OPTIONS
  - FILE-BUILD
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-BUILD-WATCH
  - FILE-DEV-SERVER
  - FILE-CONFIG
  - FILE-CLI
  - FILE-ROUTER
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - DECISION-D09-GO-ESBUILD-COMPILER
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D163-LAZY-ROUTE-VIEWS
notes:
  - kind: state
    text: >-
      Motivating case (2026-08-13): the Constellation viewer's `import('mermaid')` was inlined into
      app.js, growing it from ~340KB to 3.4MB. Workaround shipped there: vendor mermaid's chunked
      ESM build as static assets and load it with a native browser import() whose URL lives in a
      variable so esbuild leaves it alone. This feature makes that workaround unnecessary.
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-6-0
change: feature
---

# SPA code splitting

## Intent

Without splitting, a dynamic `import()` in SPA output is inlined into the single
`app.js` — there is nowhere to split to — so any app with a heavy on-demand
dependency (mermaid, a chart library, an editor, a PDF renderer) pays for it on
every page load, or vendors the dependency outside the build entirely.
`build: { splitting: true }` makes each dynamic `import()` a lazy chunk the
browser fetches when that code path runs. Splitting already existed for the
static-pages pass ([[FILE-BUILD-PRERENDER-PAGES]] runs esbuild with
`Splitting: true` across page entries); this is the same capability on the SPA
bundle path.

## Phase 1 — shipped (v1.75, [[DECISION-D160-SPA-CODE-SPLITTING]])

- Opt-in per app via `build.splitting` in [[FILE-CONFIG]] (tri-state; JSON null
  is unset, matching the other `build.*` scalars). Default off this release, and
  the default lives only in the accessor so a later release can flip it.
- [[FILE-BUILD-OPTIONS]] `newBundleOptions` sets `Splitting` +
  `ChunkNames: "chunks/[name]-[hash]"` off a `bundleFlags` bit — never globally,
  since esbuild rejects `Splitting` alongside the prerender pass's `Outfile`.
  The entry keeps its stable `app.js` name, so the shell HTML is unchanged, and
  esbuild's ESM splitting has **no chunk-loader runtime**, so total shipped
  bytes do not grow. Static imports are untouched: an app with no dynamic
  `import()` builds to one file exactly as before. Authors pick split points by
  writing `import()`; there is no per-view or per-component fragmentation.
- [[FILE-BUILD]] forces the flag off for `output: 'static'` (that pass's
  `app.js` is deleted before the swap, so its chunks would be orphans) and
  reserves `chunks/` against `public/` collisions while it is on.
- [[FILE-BUILD-WATCH]] writes the pass's outputs itself under `Write: false` and
  prunes the previous rebuild's stale chunks, so a warm dev `dist/` never
  accumulates orphans.
- [[FILE-CLI]] feeds the metafile to the size banner, which prints per-dependency
  emitted bytes and warns past 200 KB for a single dependency — the instrument
  that would have named the mermaid inline on day one.
- Embedded esbuild moved 0.19.11 → 0.28.2 in the same change; ESM splitting
  correctness (cross-chunk ordering, circular deps) improved materially after
  0.19.

Measured on a starter app with `chart.js` behind an `await import()`:
`app.js` 263.4 KB → 63.6 KB (89.8 KB → 20.9 KB gzip), the 199.3 KB remainder in
one chunk, total shipped bytes unchanged.

## Phase 2 — shipped (v1.77, [[DECISION-D163-LAZY-ROUTE-VIEWS]])

Phase 1 splits what a *dependency* costs; phase 2 splits what a *route* costs.
`lazy(loader)` from the package root marks a route `view` or `layout` as
on-demand — `view: lazy(() => import('./views/Admin.pzl'))` — and the
[[COMPONENT-ROUTER]] load phase resolves those markers after guards pass and
before any constructor or `data()` runs. The two phases compose without
touching each other: `lazy()` is the authoring seam, `build.splitting` is the
packaging switch, and the loader's `import()` is an ordinary dynamic import
that phase 1's machinery chunks (or, with splitting off, esbuild inlines while
`lazy()` keeps working).

The semantics that matter are on the decision card: a branded marker rather
than bare-function detection, one parallel `Promise.all` across the matched
chain, fulfillment memoized for the app's lifetime while rejection never is,
loader failure as an ordinary failed push through the `navigation` error phase,
and no new loading UI — the previous view holds until commit.

`examples/blog` is the acceptance case: its whole `/settings` shell and three
panes are lazy with `build: { splitting: true }`, emitting four named chunks,
and `npm run build:blog` gates it in `pretest`.

## Interactions

- SSG/hybrid: the prerender pass splits across page entries on its own, and
  Phase 1 does not double-handle it — SPA splitting applies to the browser
  bundle pass only, and static mode forces it off. Phase 2's markers are awaited
  by the Node prerender pass in both modes, and static-mode per-page module
  collection reads the stamp off the resolved class, so a lazily referenced
  view still ships in its page bundle ([[COMPONENT-SSG]]).
- `--fixtures`, dev proxy, live reload: unaffected; chunks are ordinary static
  outputs and `serve.Resolve` is name-agnostic.
