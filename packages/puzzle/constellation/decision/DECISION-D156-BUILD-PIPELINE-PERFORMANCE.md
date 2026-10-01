---
name: D156 — observable, change-aware, concurrent build pipeline
status: verified
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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D156 — observable, change-aware, concurrent build pipeline

## Context

Build and dev performance regressions (e.g. SPA startup accidentally waiting
for Tailwind's first output, which only static dev needs) were invisible
without a per-phase profile. Warm SPA rebuilds also did work unrelated to the
changed batch (full usage scans, public-tree walks, CSS recomposes), and
independent one-shot phases ran serially.

## Decision

**Profile every mode on demand.** `--profile-build` (on `puzzle build` and
`puzzle dev`) and `PUZZLE_PROFILE_BUILD=1` print per-phase startup and rebuild
tables to stderr for SPA, hybrid and static. Disabled profiling is
allocation-free at call sites; concurrent phases register an ordinal at start,
so report order is deterministic.

**SPA rebuild work follows the changed batch** — classification lives in the
watch builder so the dev server can't drift from it:

- The usage scan from context construction is reused by the initial rebuild;
  later scans run only when a `.pzl` path changed.
- Root-level public validation always runs; the full public mirror runs on the
  initial rebuild, on batches touching the current or last-successful public
  dir (deletes/renames included), and whenever the resolved public source
  differs from the last-synced one.
- A public-only batch skips esbuild when none of its paths were in the last
  successful module graph (both sides symlink-normalized). Imported public files
  still rebuild the bundle.
- The plugin advances a CSS revision only when a collected block is added,
  changed or removed. The builder commits a CSS snapshot only after a whole
  rebuild succeeds; the dev pipeline recomposes on every successful rebuild and
  Tailwind trigger, and a byte memo skips unchanged writes (still recreating an
  externally deleted `styles.css`).
- A failed esbuild pass skips public mirroring and never exposes its working CSS
  beside last-good JS, including via a later Tailwind poll. A failed stylesheet
  write doesn't arm the memo, so the next trigger retries. Public mirroring is a
  live-`dist` operation: a partial I/O failure doesn't advance bookkeeping and
  the next eligible rebuild retries the full mirror.

**Overlap only side-effect-safe one-shot work.** After config, usage and staging
setup, the browser bundle and Tailwind run concurrently. The barrier then
reports failures in browser → Tailwind order, composes component CSS after the
browser collector is filled, and runs public copying and prerender phases in
their existing order (public copy after generated root outputs, because the
public contract allows colliding root names and overlap would race). All writes
stay in staging until the atomic swap; no user code runs and no partial output
is published after a browser failure.

The static watch builder uses the same candidate/committed CSS boundary:
`RecomposeStyles` reads only the snapshot adopted after a successful swap.

## Alternatives

- Persistent node prerender worker — changes module invalidation and app-global
  isolation; separate decision if profiling proves the need.
- Disk-backed or process-wide `.pzl` cache — widens invalidation risk; the
  build-scoped cache and esbuild contexts own their lifetimes.
- JSON-only config fast path — `puzzle.config.js` is executable JS with imports
  and env reads.
- Wall-clock CI budgets — host timing is noisy.

## Consequences

**Gates are deterministic scheduling and call-count tests; timing fixtures are
advisory.** SPA, hybrid and static keep identical artifact and failure
contracts, ordinary public-only saves skip esbuild, and Tailwind-heavy one-shot
builds overlap Tailwind with bundling.
