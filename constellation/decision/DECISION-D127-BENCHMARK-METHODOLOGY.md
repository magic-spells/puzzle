---
name: >-
  D127 — the production benchmark harness: production-only measurement, medians, and structural exit
  codes
status: built
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
---

# D127 — the production benchmark harness: production-only measurement, medians, and structural exit codes

## Context

Every performance number this project had before `benchmarks/` came from a
**development** build — HMR machinery, the D100 DevTools bridge, D121 per-view
dev registration, unminified code. `examples/stress` ([[DOC-STRESS-EXAMPLE]])
could produce numbers by hand, but nothing recorded them reproducibly, nothing
asserted that a timed op had actually done the work its name claimed, and
nothing protected the numbers from the several ways a browser will quietly hand
back fiction.

## Decision

`benchmarks/` is a **local instrument, not a CI gate**: `npm run bench` and
`npm run bench:update`. `runner.mjs` builds a scratch copy of `examples/stress`
in production mode, serves it, drives `window.__STRESS__` through the op matrix
in `scenarios.mjs`, and prints medians against a committed `baseline.json`.
`probe.mjs` is the mirror image — the same staged copy built in **development**
mode, handed to an arbitrary probe script, **counters only**, because the
framework's own structural counters live in [[FILE-DEVPERF]] and production
compiles them out. Methodology, the op tables, and the recorded results are in
`benchmarks/README.md`; this card holds the rules and the reasons.

### 1. Production builds only, and the build is verified rather than trusted

Dev-build numbers do not merely run slow. The dev build's cost tracks **mounted
view count** at a strikingly stable **3–4 microseconds per mounted view** across
two orders of magnitude — which is **+190ms** on a 50k full-DOM create against
**+3ms** on the windowed one. The penalty lands almost entirely on the strategy
that mounts many views, so a dev-build A/B **overstates the case for windowing**,
which is the single comparison the stress lab exists to make. Development
numbers are not a scaled version of production numbers; they are a different
answer.

The runner does not trust the `--mode` flag either — it greps the emitted bundle
for `__PUZZLE_DEVTOOLS_HOOK__`, `import.meta.hot` and `puzzle:hmr` and refuses to
run a "production" build containing any of them, then snapshots `dist/` before
serving so a rebuild in another terminal cannot change the bytes mid-suite.

### 2. CDP `ScriptDuration` is unusable and is deliberately not reported

Blink's script bucket does not account for this work. On a `create-10k` costing
**182.9ms** of measured in-page script time, `Performance.getMetrics` reported
**2.91ms** of `ScriptDuration`. In the same sample `LayoutDuration` (144ms),
`RecalcStyleDuration` (90.7ms) and `TaskDuration` (491.6ms against 472ms of wall
time) were all correct. The framework's own JavaScript lands in
`TaskOtherDuration`.

Reporting `ScriptDuration` would state that Puzzle's JavaScript is essentially
free, which is the exact opposite of true. The harness reports
`task` / `layout` / `style` / `other`, where `other = task - layout - style` is
the honest stand-in. **Anyone rebuilding this instrument will reach for
`ScriptDuration` first and get fiction that looks authoritative.**

A related trap: work driven by `page.evaluate` runs in a CDP-injected task the
renderer does not attribute at all. Every timed op is therefore kicked off from
a `setTimeout(0)` so it lands in an ordinary page task.

`Tracing.start`/`Tracing.end` was evaluated and rejected — tens of megabytes per
iteration at 50k rows across ~450 recorded iterations, to answer a question
`getMetrics` deltas already answer. Reach for tracing when a flame chart is
wanted, not a number.

### 3. Medians of 15 after warmup, never means

One GC pause ruins a mean and leaves a median untouched. Each op runs its
scenario warmup, 3 untimed real iterations, then 15 recorded ones, and
`HeapProfiler.collectGarbage` forces a full GC before every timed iteration so no
iteration absorbs a collection its predecessors earned. The table prints **MAD%**
(median absolute deviation) beside each median rather than a standard deviation,
which would describe a distribution nobody is reporting.

Repeat-run variance was measured on an unchanged tree, twice: for ops with a
script median at or above 5ms, run-to-run disagreement has a **median of 1.4%**
and a **worst case of 12.9%** — against effects the suite exists to show that run
3x to 255x. **Treat anything under ~13% as noise on those ops; sub-5ms ops cannot
be compared at all** and the table prints `flr` rather than a percentage whenever
either side is at the measurement floor. The drifts are not randomly scattered —
small and teardown-heavy ops look systematically drift-prone (allocator or
thermal state), so sub-13% deltas on those rows deserve extra suspicion.

### 4. Exit status is driven by structural counters ONLY, never by timing

Non-zero exit means a `validate()` failure, a structural-counter mismatch, an op
that threw or timed out, or a rejected throttle-clamped sample set. **Never a
timing regression.** Timing on a developer laptop is noise; `Δscript`/`Δpaint` are
display-only. `mountedNodes` / `views` / `records` are deterministic properties of
the render algorithm, so they are hard-asserted four ways and are the only thing
the exit code is allowed to depend on.

### 5. `validate()` gates every timed run, and every create declares `preExpect`

`validate()` runs **before** the timed op — never benchmark a broken render — and
**after** it. Every recorded iteration is preceded by untimed prepare ops that
restore the precondition exactly, and each op asserts a `preExpect` against the
prepared state before the timed window opens.

Every create declares `preExpect: { records: 0 }`, and that is not defensive
tidiness. `RowOps.freshSeed()` **rewinds the deterministic fixture seed**, so a
create starting from a non-empty list regenerates rows with identical ids and
identical content; keyed reconciliation matches them and patches almost nothing.
Measured with 1,000 rows already present, `create-1k` produced **1,001 of 1,003
renders wasted and 95 DOM mutations** — and still rendered correctly, so
`validate()` passed and the number looked entirely plausible. It was a no-op
patch wearing a create's name. (Same rewind, read from the other side, is the
[[DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL]] wasted-render finding.)

### 6. The scratch-build rule: never build into `examples/*/dist`

The harness builds into `benchmarks/.build/stress-src/` and serves that copy's
`dist/`. It never writes to `examples/stress/dist/`.

This is not a stylistic preference — it happened. `puzzle build` has no
output-dir flag, so building the example in place overwrites the dev bundle a
human's browser is holding open, and because a production build strips the
DevTools bridge by design, their Performance panel went dead with "No Puzzle app
detected" and nothing said why. The staged copy lives inside the repo so
`@magic-spells/puzzle` still resolves through the root `node_modules`, and
byte-identity of `examples/stress/dist/app.js` across a run is checked by
checksum. The static server binds 127.0.0.1:4290 (probe: 4291) and **fails with
an instruction** on a busy port rather than killing a process it did not start.

### 7. A throttled renderer must be proven absent, not assumed

Chrome throttles rAF to ~1Hz and clamps `setTimeout` to ~1000ms in a backgrounded
or occluded renderer. Puzzle schedules **both** store flushes and view renders on
rAF, so a throttled tab does not produce slightly-slow numbers — it produces
numbers **quantized to whole seconds**. That signature has already fooled one
measurement in this project. Four independent defences: Chromium launch flags,
a `document.visibilityState` check, a calibration probe printed in the report
header, and a screen that loudly rejects any sample set with 60%+ of its samples
within 60ms of a positive multiple of 1000ms.

Guard 7 is why `async-waterfall` runs at **`delay=35`, not 50**: twenty
serialized cells at 50ms land at ~1000ms, indistinguishable from a single clamped
timer — the exact artifact the guard exists to catch. At 35ms they land at
~700ms, and a genuinely clamped run would read ~20,000ms. It is also why the
`islands` matrix times the fixed-**render-count** arm rather than the fixed-
**duration** one: a fixed-duration op's milliseconds are an input, not a
measurement, and all three of its samples landed within 60ms of a whole second.

The verdict for a concurrency question never comes from the clock — it comes
from the in-page census (`maxInFlight`), because wall time alone cannot
distinguish "serialized" from "slow".

## Alternatives rejected

- **Measure the development build** — the whole point of the harness. See rule 1.
- **Report CDP `ScriptDuration`** — measured wrong by ~63x. See rule 2.
- **Per-iteration Chrome tracing** — gigabytes for a number `getMetrics` already
  gives; the right tool for a flame chart, not for a suite.
- **Fail the run on a timing regression** — makes the instrument's noise floor
  into a build gate; the variance study above says 13% is noise.
- **Build the example in place** — a real incident, not a hypothetical. See
  rule 6.
- **Kill whatever holds the port** — the harness did not start it.
- **Report a mean, or a standard deviation beside a median** — one GC pause; and
  a σ describes a distribution nobody is reporting.

## Consequences

The project has one reproducible instrument that measures what users ship, and
its numbers are falsifiable — every op carries a structural assertion, so an op
with no counter contributes a number nobody can check. The published results
carry named limitations: one machine, headless-only (which runs rAF at ~120Hz
with no vsync, so fixed-duration ops tick at roughly double the expected rate),
no cross-framework comparability, no memory-retention analysis, and absolute
numbers that legitimately **disagree** with the hand-run figures in
`examples/stress/README.md` — that disagreement is the argument for having a
harness, not a defect in one.

Adding an op is appending an entry to `OPS` in `scenarios.mjs`; nothing else
changes. The op `id` is the `baseline.json` key, so renaming one makes every
delta read as new.
