---
name: >-
  D130 — SSG takeover is a build-mode feature: __PUZZLE_TAKEOVER__ keeps the prerender-adoption path
  out of plain SPA bundles
status: verified
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D67-SSG-STATIC-BUILD
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

# D130 — SSG takeover is a build-mode feature

`puzzle build` and `puzzle build --hybrid` emitted **byte-identical `app.js`**.
One bundle served both modes, which is precisely the mechanism hybrid uses —
[[DECISION-D67-SSG-STATIC-BUILD]] specifies that "the unchanged SPA runtime takes
over on load," and names one runtime code path after takeover as an invariant.

The consequence was that every plain SPA shipped `client-runtime/ssg/preload.js`
plus the router's three `data-puzzle-ssg` branches — code that **cannot run** in a
SPA build, because nothing stamps the marker into that shell.

## What was and was not already contained

The build-time SSG *generator* was never in the bundle and is not what this card
changes. `ssg/index.js` (the prerender orchestrator) and `ssg/serialize.js`
compile into the separate node-platform prerender bundle D67 introduced, run once
under `node`, and are correctly absent from `app.js`.

`ssg/preload.js` was the single exception: **takeover-client code filed under
`ssg/`**, imported at top level by `router/router.js`. Before it, the router
imported nothing from `ssg/` at all.

## Decision

`__PUZZLE_TAKEOVER__`, a boolean esbuild define beside `__PUZZLE_DEV__` and
`__PUZZLE_HAS_FLIP__`, meaning **"this bundle may adopt prerendered DOM."**

| bundle | value | why |
|---|---|---|
| hybrid app bundle | `true` | the router adopts the `data-puzzle-ssg` container at navigation zero |
| true-static per-page | `true` | `mountStatic` adopts the prerendered page ([[DECISION-D81-STATIC-PAGES-MODE]]) |
| dev / watch | `true` | never regress `puzzle dev` |
| plain SPA | `false` | nothing ever stamps the marker |
| node prerender | `false` | it **generates** the markup and never adopts it |

The flags are carried by a `bundleFlags` struct rather than a second positional
bool, so every call site names what it wants and a future define cannot silently
default an existing caller to the wrong value.

The runtime probes the define **inline at each branch** with the
`typeof … === 'undefined' ||` idiom, so an absent define means ON — vitest and any
third-party bundler keep the takeover path. Hoisting the probe into a module-level
`const` breaks the fold silently; esbuild does not constant-propagate it into
method scopes. Same trap already recorded for `__PUZZLE_DEV__`.

## Why gating rather than relocating the module

Moving `preload.js` out of `ssg/` would make the directory honest again — it
currently mixes three build-time-only modules with one runtime module, and nothing
marks which is which — but a rename removes no code from a SPA bundle.

The define does both jobs. With it false, **no `ssg/` module reaches a SPA bundle
at all**, which converts "everything under `ssg/` is build-time only" from a
convention into an assertion a build test can enforce.

## What it costs

`app.js` stops being mode-independent. A SPA-built bundle served against
prerendered HTML will no longer take over — it will clear the markup and render
client-side, silently rather than loudly.

Nothing in the repo does this, and both prerender modes emit their own `app.js`
alongside their own HTML, so bundle and markup always ship together. Recorded
because D67 leaned on the two builds being interchangeable, and that property is
now deliberately gone.

## Scope: the marker branches, and the bookkeeping behind them

The define removes two distinct things, and they needed separate treatment.

**Behind the marker check** — the router's `isSSGTakeover` computation, the nested
component preload block, and `#takeoverSSG` — folds away as one unit, taking
`preload.js` with it once the import loses its only consumer
(`"sideEffects": false` permits the drop).

**Not behind any marker check** — the takeover *bookkeeping* threaded into the
general mount path: `ViewNode`'s `takeoverPreloaded`/`takeoverFailed` fields, their
copies in `viewManager`'s two clone sites, its mount-failure branch, and
`PuzzleView`'s `__takeoverTree` read. That code ran in **every** app regardless of
mode, so it is gated by the same define.

The bookkeeping is gated, never made lazy. Conditionally assigning the `ViewNode`
fields would give different vnodes different hidden-class shapes; because the
define folds to a literal, gating keeps exactly one shape per build.

## Verification posture

Zero-byte claims here are measured against a real production build, the same
standard [[DECISION-D121-DEV-PERFORMANCE-PROFILING]] set.

Two probes discriminate and most do not. The property names `takeoverPreloaded`,
`takeoverFailed`, and `__takeoverTree` are **not** minified, and until the
bookkeeping was gated they survived in every bundle no matter what the router did
— asserting their absence would have failed while testing nothing. The reliable
probes are the `data-puzzle-ssg` string literal and the sole *assignment* to
`__takeoverTree`, which lives only in `preload.js`.

Note that vitest never exercises the gated-**off** path: the define is absent
there, so every gate is ON. The Go build tests are the only thing that verifies
the dead-code elimination actually fires, and each assertion is checked
non-vacuously by forcing the define true.
