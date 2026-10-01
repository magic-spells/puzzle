---
name: >-
  D130 — SSG takeover is a build-mode feature: __PUZZLE_TAKEOVER__ keeps the prerender-adoption path
  out of plain SPA bundles
status: verified
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-BUILD
verified_at: '2026-07-27T04:56:00.000Z'
verified_sha: c6b0dd9b8a28e8686d17b364150ae9b82912e92f
---

# D130 — SSG takeover is a build-mode feature: `__PUZZLE_TAKEOVER__`

`__PUZZLE_TAKEOVER__` is a boolean esbuild define meaning **"this bundle may
adopt prerendered DOM"**, so plain SPA bundles don't ship the takeover path
(`ssg/preload.js` plus the router's `data-puzzle-ssg` branches) that can never
run there.

| bundle | value | why |
|---|---|---|
| hybrid app bundle | `true` | the router adopts the `data-puzzle-ssg` container at navigation #0 (D67) |
| static per-page | `true` | `mountStatic` adopts the prerendered page (D81) |
| dev / watch | `true` | never regress `puzzle dev` |
| plain SPA | `false` | nothing stamps the marker |
| node prerender | `false` | generates markup, never adopts it |

## Rules

- Flags travel in a `bundleFlags` struct (`options.go`), not positional bools,
  so no call site silently defaults a new define.
- Probes are inline at each branch with the
  `typeof __PUZZLE_TAKEOVER__ === 'undefined' || …` idiom (absent = on, so vitest
  and foreign bundlers keep the path). A module-level const doesn't fold (D89).
- Gated: the router's `isSSGTakeover`, nested component preload and
  `#takeoverSSG` (taking `preload.js` with them), **and** the takeover
  bookkeeping in the general mount path — `ViewNode`'s
  `takeoverPreloaded`/`takeoverFailed`, their copies in `viewManager`'s clone
  sites and mount-failure branch, and `PuzzleView`'s `__takeoverTree` read.
  Bookkeeping is gated, never made lazy: conditional field assignment would give
  vnodes different hidden-class shapes; a folded literal keeps one shape per
  build.
- With the define false **no `ssg/` module reaches a SPA bundle**, so "everything
  under `ssg/` is build-time only" is enforceable.

## Consequences

- `app.js` is no longer mode-independent: a SPA-built bundle served against
  prerendered HTML clears the markup and renders client-side. Both prerender
  modes emit their own `app.js`, so bundle and markup always ship together.
- **Verification:** property names like `takeoverPreloaded` aren't minified and
  so aren't discriminating probes; use the `data-puzzle-ssg` literal and the sole
  assignment to `__takeoverTree` (only in `preload.js`). Vitest never exercises
  the gated-off path — the Go build tests are the only DCE check, each made
  non-vacuous by forcing the define true.

## Alternatives

- **Relocate `preload.js` out of `ssg/`** — tidier naming but removes no bytes.
