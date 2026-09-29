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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D128 — The production benchmark harness

`benchmarks/` is a **local instrument, not a CI gate** (`npm run bench`,
`npm run bench:update`). `runner.mjs` builds a scratch copy of `examples/stress`
([[DOC-STRESS-EXAMPLE]]) in production mode, serves it, drives
`window.__STRESS__` through the op matrix in `scenarios.mjs`, and prints medians
against `baseline.json`. `probe.mjs` builds the same copy in **development** mode
for counters only (the structural counters live in [[FILE-DEVPERF]], compiled out
of production). Methodology and results: `benchmarks/README.md`. Adding an op is
one entry in `OPS`; its `id` is the baseline key (renaming reads as new).

## Rules

1. **Production builds only, verified.** Dev builds cost ~3–4µs per mounted view,
   which skews exactly the full-DOM vs windowed comparison the lab exists for.
   The runner greps the bundle for `__PUZZLE_DEVTOOLS_HOOK__`, `import.meta.hot`
   and `puzzle:hmr` and refuses a "production" build containing any — also under
   `--no-build`, since both modes stage into one directory.
2. **Never report CDP `ScriptDuration`** — Blink's bucket misses this work by
   ~60x. Report `task`/`layout`/`style`/`other` (`other = task − layout − style`).
   Timed ops start from a `setTimeout(0)` because work driven by `page.evaluate`
   runs in an unattributed CDP task. Tracing is for flame charts, not numbers.
3. **Medians of 15 after warmup** (scenario warmup + 3 untimed), forced GC
   (`HeapProfiler.collectGarbage`) before each timed iteration, MAD% beside each
   median. Measured repeat-run noise on ops ≥5ms: median 1.4%, worst 12.9% —
   treat <~13% as noise; sub-5ms ops print `flr` and can't be compared.
4. **Exit status is structural only, never timing:** `validate()` failure,
   counter mismatch (`mountedNodes`/`views`/`records`), a thrown or timed-out op,
   a throttle-clamped sample set, or an uncaught page error. `console.error` is
   printed, never fatal (recovery paths log on purpose). `--update-baseline`
   refuses non-ok runs, dev builds and `--filter` (the file is written whole).
5. **`validate()` before and after every timed op**, untimed prepare ops restore
   the precondition, and each op asserts `preExpect`. Every create declares
   `preExpect: { records: 0 }`: `RowOps.freshSeed()` rewinds the fixture seed, so a
   create over a non-empty list regenerates identical rows and patches almost
   nothing while still validating.
6. **Never build into `examples/*/dist`.** `puzzle build` has no out-dir flag;
   building in place once overwrote a dev bundle a browser held open and killed
   its DevTools panel. The harness stages into `benchmarks/.build/stress-src/`
   (inside the repo so the package resolves). Servers bind 127.0.0.1:4290
   (probe: 4291) and fail with an instruction on a busy port — never kill a
   process they didn't start.
7. **Prove the renderer isn't throttled.** A backgrounded tab clamps rAF (which
   drives both store flushes and renders) and timers to ~1s, quantizing samples
   to whole seconds. Defences: launch flags, a `visibilityState` check, a
   calibration probe in the report header, and rejection of sample sets with
   ≥60% of samples within 60ms of a whole second. Hence `async-waterfall` runs at
   `delay=35` (20×50ms ≈ 1000ms would mimic a clamp), and `islands` times the
   fixed-render-count arm. Concurrency verdicts come from the in-page census
   (`maxInFlight`), never the clock.

## Limitations

One machine, headless only (rAF ~120Hz, no vsync), no cross-framework
comparability, no memory-retention analysis. Absolute numbers legitimately
disagree with the hand-run figures in `examples/stress/README.md`.
