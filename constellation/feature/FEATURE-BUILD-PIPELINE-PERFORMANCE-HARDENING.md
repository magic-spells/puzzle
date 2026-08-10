---
name: Build pipeline performance hardening
status: building
branch: perf/0.6-build-pipeline
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
---

# Build pipeline performance hardening

The `release/0.6.0` compiler work restored fast SPA startup after removing an
accidental Tailwind readiness wait. Finish the round by pinning that boundary,
making warm SPA work change-aware, exposing profiles in every dev mode, and
overlapping independent one-shot compilation without weakening atomic output.

## Scope

- In: `puzzle dev --profile-build`, deterministic SPA/static startup coverage,
  path-aware usage/public work, CSS revision tracking, safe one-shot phase
  concurrency, and opt-in large-SPA timing fixtures.
- Out: config-format changes, persistent Node workers, cross-process compiler
  caches, SPA HMR/module swapping, transactionally staging the whole SPA dev
  output, or changes to generated runtime behavior.

## Acceptance

- SPA startup never waits for Tailwind first output; static startup still does.
- Initial SPA startup performs one usage scan, non-`.pzl` edits perform none,
  and public/CSS work runs only when its inputs changed.
- A failed SPA or static multi-file build cannot leak partially updated
  component CSS through the Tailwind callback; failed stylesheet writes remain
  pending for retry.
- Serial and concurrent test strategies produce byte-identical SPA, hybrid, and
  static trees; injected failures preserve error priority and last-good `dist/`.
- Profiling is opt-in, stable, and covers SPA startup plus every rebuild mode.
- Repeated reference benchmarks show no material Canvas startup regression and
  measurable wins on large warm SPA and Tailwind-enabled one-shot builds.
- The JavaScript suite, Go suite, and affected race tests pass.
