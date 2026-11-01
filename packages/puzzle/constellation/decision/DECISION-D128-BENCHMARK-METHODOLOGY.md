---
name: >-
  D128 — The production benchmark harness: production-only measurement, medians, structural exit
  codes
status: verified
connections:
  - DOC-STRESS-EXAMPLE
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL
  - DECISION-D62-HANDLER-CACHING
  - DOC-TESTING
  - DOC-DEVELOPMENT
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-FORMATTERS
  - FILE-DEVPERF
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D128 — The production benchmark harness

`benchmarks/` is a **local instrument, not a CI gate**. `npm run bench`
(`runner.mjs`) builds a scratch copy of `examples/stress` ([[DOC-STRESS-EXAMPLE]])
in production mode, serves it, drives `window.__STRESS__` through the op matrix
in `scenarios.mjs`, and prints medians against `baseline.json`. `probe.mjs` (and
its `probe-*.mjs` scripts) builds the same copy for structural counters only —
in development mode for the framework counters in [[FILE-DEVPERF]], which
compile out of production. Settings live in `playwright.benchmark.config.js` (a
plain module for the Playwright library API, not a test-runner config).
Methodology and current results: `benchmarks/README.md`. Adding an op is one
entry in `OPS`; its `id` is the baseline key (renaming reads as a new op).

## Decision

1. **Production builds only, verified.** Dev builds carry HMR, the DevTools
   bridge and per-view dev bookkeeping, which skews exactly the full-DOM vs
   windowed comparison the lab exists for. The runner greps the bundle for
   `__PUZZLE_DEVTOOLS_HOOK__`, `import.meta.hot` and `puzzle:hmr` and refuses a
   "production" build containing any — also under `--no-build`, since both modes
   stage into one directory.
2. **Never report CDP `ScriptDuration`** — Blink's bucket misses most of this
   work. Report `task`/`layout`/`style`/`other` (`other = task − layout −
   style`). Timed ops start from a `setTimeout(0)` because work driven by
   `page.evaluate` runs in an unattributed CDP task. Tracing is for flame charts,
   not numbers.
3. **Medians after warmup.** The scenario's own `warmup()`, then untimed
   iterations, then the recorded iterations (counts in the config), with a forced
   GC (`HeapProfiler.collectGarbage`) before each and MAD% beside each median. A
   difference inside the repeat-run noise the README records is not a result;
   ops below the timer floor print `flr` and can't be compared.
4. **Exit status is structural only, never timing:** a `validate()` failure, a
   counter mismatch (`mountedNodes`/`views`/`records`), a thrown or timed-out op,
   a throttle-clamped sample set, or an uncaught page error. `console.error` is
   printed, never fatal (recovery paths log on purpose). `--update-baseline`
   refuses non-ok runs, dev builds and `--filter` (the file is written whole).
5. **`validate()` before and after every timed op**; untimed prepare ops restore
   the precondition, and each op asserts `preExpect`. Every create declares
   `preExpect: { records: 0 }`: `RowOps.freshSeed()` rewinds the fixture seed, so
   a create over a non-empty list regenerates identical rows and patches almost
   nothing while still validating.
6. **Never build into `examples/*/dist`.** `puzzle build` has no out-dir flag,
   and building in place once overwrote a dev bundle a browser held open and
   killed its DevTools panel. The harness stages into
   `benchmarks/.build/stress-src/` (inside the repo so the package resolves).
   Servers bind 127.0.0.1:4290 (probe: 4291) and fail with an instruction on a
   busy port — never kill a process they didn't start.
7. **Prove the renderer isn't throttled.** A backgrounded tab clamps rAF (which
   drives both store flushes and renders) and timers to ~1s, quantizing samples
   to whole seconds. Defences: launch flags, a `visibilityState` check, a
   calibration probe in the report header, and rejection of sample sets where
   most samples sit next to a whole second (`detectClamp`). So no op may be
   designed to take ~1s by construction: `async-waterfall` runs at `delay: 35`,
   and concurrency verdicts come from the in-page census (`maxInFlight`), never
   the clock.
8. **Per-release history.** On the clean release tree: `npm run bench:update`,
   then `npm run bench:snapshot` (copies `baseline.json` to
   `benchmarks/history/<version>.json`; refuses a baseline measured on a dirty
   tree). `npm run bench:history` compares snapshots, which are comparable only
   because they come from one machine and browser.

## Limitations

One machine, headless only (no vsync), no cross-framework comparability, no
memory-retention analysis. Absolute numbers legitimately differ from the
hand-run figures in `examples/stress/README.md`.
