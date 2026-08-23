---
name: Build pipeline performance hardening
status: verified
connections:
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
  - FILE-BUILD
  - FILE-BUILD-WATCH
  - FILE-CLI
  - FILE-DEV-SERVER
  - DOC-SPEC-BUILD
verified_at: '2026-08-16T04:34:46.873Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
release: RELEASE-V0-6-0
change: feature
---

# Build pipeline performance hardening

The 0.6.0 compiler round that pins the SPA/static Tailwind-readiness boundary,
makes warm SPA rebuild work follow the changed batch, exposes a per-phase
profile in every mode, and overlaps independent one-shot compilation without
weakening atomic output. Shipped as
[[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]].

## Scope

- In: `puzzle dev --profile-build`, deterministic SPA/static startup coverage,
  path-aware usage/public work, CSS revision tracking, safe one-shot phase
  concurrency, and opt-in large-SPA timing fixtures.
- Out: config-format changes, persistent Node workers, cross-process compiler
  caches, SPA HMR/module swapping, transactionally staging the whole SPA dev
  output, or changes to generated runtime behavior.

## Behavior it guarantees

- SPA startup never waits for Tailwind first output; static startup still does.
- Initial SPA startup performs one usage scan, non-`.pzl` edits perform none,
  and public/CSS work runs only when its inputs changed.
- A failed SPA or static multi-file build cannot leak partially updated
  component CSS through the Tailwind callback; failed stylesheet writes remain
  pending for retry.
- Serial and concurrent build strategies produce byte-identical SPA, hybrid, and
  static trees; injected failures preserve error priority and last-good `dist/`.
- Profiling is opt-in, stable, and covers SPA startup plus every rebuild mode —
  `--profile-build` on `puzzle build`/`puzzle dev`, or `PUZZLE_PROFILE_BUILD=1`
  for any process that calls the builder. Phases register their report ordinal
  at start, so concurrent phases cannot reorder the table.
