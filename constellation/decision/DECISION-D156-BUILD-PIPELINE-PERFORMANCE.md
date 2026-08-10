---
name: D156 — observable, change-aware, concurrent build pipeline
status: built
connections:
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-SSG
  - FLOW-BUILD
  - FILE-BUILD
  - FILE-BUILD-WATCH
  - FILE-CLI
  - FILE-DEV-SERVER
  - DOC-SPEC-BUILD
  - FEATURE-BUILD-PIPELINE-PERFORMANCE-HARDENING
---

# D156 — observable, change-aware, concurrent build pipeline

## Context

The first `release/0.6.0` performance pass accidentally made SPA startup wait
for Tailwind's first output, taking the Canvas example from roughly 70ms to
230ms. The wait belongs only to static dev, where the first prerender must
contain final CSS; SPA dev can serve immediately and recompose when the warm
Tailwind child writes. The regression was fixed, but no deterministic test or
SPA startup profile made the boundary visible.

The remaining work is smaller but repeated: SPA startup scans usage twice;
every warm rebuild walks all `.pzl` and public paths even when the changed batch
cannot affect them; CSS is recomposed when the collected blocks did not change;
and independent one-shot compilation phases run serially.

## Decision

**Profile every dev mode on demand.** `puzzle dev --profile-build` and
`PUZZLE_PROFILE_BUILD=1` report stable, per-phase startup and rebuild tables to
stderr for SPA, hybrid, and static projects. Disabled profiling stays allocation
free at phase call sites. Concurrent phases register an ordinal at start and
finish under a mutex, so report order is deterministic rather than
completion-ordered.

**Make SPA rebuild work follow the changed batch.** The watch builder owns the
classification so the dev server cannot drift from its invariants:

- the usage scan performed while constructing the esbuild context is reused by
  the initial rebuild, and later scans run only when a `.pzl` path changed;
- the cheap root-level public validation remains unconditional, while the full
  public-tree mirror runs on the initial rebuild and on batches touching the
  current or last-successful public directory, including deletes and renames;
- a public-only batch skips esbuild when none of its paths participated in the
  last successful module graph. Imported public files still rebuild both the
  browser bundle and public mirror;
- the plugin advances a CSS revision only when a collected block is added,
  changed, or removed. The builder publishes a committed CSS snapshot/revision
  only after the entire rebuild succeeds, and the caller recomposes only when
  that committed revision moves.

A failed esbuild pass skips public mirroring and may have populated the plugin's
private working map, but neither the normal path nor a Tailwind poll can expose
that CSS beside last-good JavaScript. Snapshotting the working map is deferred
until a later successful pass because esbuild may reuse successful onLoad work
from the failed attempt. A failed stylesheet write stays dirty and retries on
the next source or Tailwind trigger. Tailwind output remains its own recompose
trigger, gated on the first successful SPA bundle. Public mirroring remains a
live-dist operation: if its I/O fails after some copies, ownership bookkeeping
does not advance and the next eligible rebuild retries the full mirror; making
the entire SPA output transactionally atomic is a separate change.

**Overlap only side-effect-safe one-shot work.** After config, usage, and
staging setup, browser bundling and Tailwind generation run concurrently. The
barrier then:

1. reports failures in the existing browser → Tailwind order;
2. composes component CSS only after the browser pass populated its collector;
3. performs public copying and every prerender phase in their existing order.

Public copying deliberately stays ordered after generated root outputs. The
current public contract permits root directories whose names collide with
generated files, and overlapping those writes would turn the existing
deterministic error into a filesystem race. All writes stay inside staging until
the atomic swap. Tailwind may do harmless extra work after a browser failure,
but Puzzle never executes user `beforeMount`/`data()` code, publishes partial
output, or changes the last-good artifact on that path.

The static watch builder uses the same candidate/committed CSS boundary. Its
staging build may compose from the candidate, but `RecomposeStyles` reads only
the snapshot adopted after a successful staging swap and remains a no-op until
the session has landed its first build. Thus an app-pass error cannot leak
working CSS over the last-good static site through a later Tailwind event.

## Alternatives rejected

- **Persistent Node prerender worker.** It changes module invalidation and
  app-global isolation; it remains a separate decision after profiling proves
  the need.
- **Disk-backed or process-wide `.pzl` cache.** The one-shot cache and esbuild's
  live context already own their safe lifetimes; widening either adds invalidation
  risk to this low-risk pass.
- **A JSON-only config fast path.** `puzzle.config.js` is executable JavaScript
  with imports, computed values, and environment reads. Caching or replacing it
  changes config semantics to save the current 45–48ms cold-load floor.
- **Wall-clock CI budgets.** Host timing is noisy. Deterministic scheduling and
  call-count tests are gates; repeated timing fixtures are advisory evidence.

## Consequences

SPA, hybrid, and static output keep identical artifact and failure contracts.
Small SPA startup stays near the restored baseline, large warm rebuilds avoid
unrelated project walks, ordinary public-only saves avoid esbuild entirely, and
Tailwind-heavy one-shot builds no longer add the browser-bundle duration to
Tailwind generation. The profiler and benchmark fixtures make later
performance work attributable instead of anecdotal.
