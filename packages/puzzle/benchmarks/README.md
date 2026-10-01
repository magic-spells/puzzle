# Puzzle production benchmark

The instrument that measures what users actually ship.

```bash
npm run bench            # measure, print the table, compare against baseline.json
npm run bench:update     # the same, then rewrite baseline.json
npm run bench:snapshot   # copy baseline.json to history/<version>.json
npm run bench:history    # the headline ops across every release snapshot
```

Every performance number this project had before this harness came from a
**development** build — HMR machinery, the DevTools bridge, per-view dev
registration, unminified code. Those numbers are directionally useful and
nothing more. This harness builds `examples/stress` in production mode, serves
the static output, and drives it through `window.__STRESS__`.

The gap is not hypothetical. Measured through this same harness (see
[Production versus development](#production-versus-development)), the dev build
adds roughly **3–4 microseconds per mounted view**: **+40ms** on a 10k
full-DOM create, while the windowed create at the same size runs **13ms faster**
in dev than it ships. It does not merely shift the numbers, it distorts the
comparison *between* rendering strategies, which is the comparison the stress
lab exists to make.

---

## Layout

| file | role |
| --- | --- |
| `../playwright.benchmark.config.js` | build/server/browser/iteration settings. **Not** a `@playwright/test` config — see its header. |
| `scenarios.mjs` | the op matrix: what runs, at what size, with what preparation and assertions |
| `runner.mjs` | the driver: build, serve, launch, calibrate, iterate, assert |
| `harness-lib.mjs` | the staging/build and static-server plumbing `runner.mjs` and `probe.mjs` share. Each driver keeps its OWN assertion about the bundle (no dev markers vs. a `__PUZZLE_PERF__` sentinel); everything mechanical lives here once. |
| `report.mjs` | medians, MAD, clamp detection, baseline delta, table rendering |
| `baseline.json` | committed reference numbers. Structural counters are asserted against it; timings are informational. |
| `history/<version>.json` | `baseline.json` frozen at each release, same shape. See [Across releases](#across-releases). |
| `history.mjs` | `--snapshot` writes the current baseline into `history/`; with no flag it prints the headline ops across every snapshot (`--all` for every op they share). |
| `probe.mjs` | the mirror image of `runner.mjs`: builds the same staged copy in **development** mode and hands the page to an arbitrary probe script. Counters only — see below. |
| `probe-route-churn.mjs` | per-level render / `data()` / mutation counters for `route-churn`, plus a hard failure if the D121 detector fired |
| `probe-listener-churn.mjs` | exact listener-call counts per arm, and the micro decomposition that prices the invoker pattern |

### Every path this harness writes to

**It writes to exactly two places, both gitignored, both under `benchmarks/`:**

| path | contents |
| --- | --- |
| `benchmarks/.build/stress-src/` | a scratch copy of the example's source (`app/`, `public/`, `puzzle.config.js`, `package.json`) **and its `dist/`** — the bundle actually served |
| `benchmarks/.last-run.json` | the most recent run, so a failed run can still be diffed by hand |

Plus `benchmarks/baseline.json`, but only under `npm run bench:update`, and
`benchmarks/history/<version>.json`, but only under `npm run bench:snapshot`.

**It never writes to `examples/stress/dist/`.** That directory belongs to
whoever is running `puzzle dev`, and the benchmark stays out of it. This is not
a stylistic preference — it was a real incident. `puzzle build` has no
output-dir flag (`--fixtures`, `--hybrid`, `--mode`, `--profile-build`,
`--static` is the entire set), so building the example in place emits `examples/stress/dist` and
overwrites the dev bundle a human's browser is holding open. Because a
production build strips the DevTools bridge by design, their Performance panel
went dead with "No Puzzle app detected" and nothing said why.

So the runner copies the example's source into `benchmarks/.build/stress-src`
and builds the copy. The copy lives inside the repo, so `@magic-spells/puzzle`
still resolves to the in-repo runtime (the compiler walks up to the checkout's
`client-runtime/`) exactly as it does for the example (`examples/stress` has no
`node_modules` of its own). Verified by
checksum: `examples/stress/dist/app.js` is byte-identical before and after a
benchmark run.

### Ports

The static server binds **127.0.0.1:4290**, chosen to stay clear of the ports
humans and other suites use here — 3000 and 4190 are dev servers, 4173/4174
belong to `playwright.config.js`. If 4290 is taken the runner **fails with an
instruction** rather than killing a process it did not start; change
`server.port` in `playwright.benchmark.config.js` to another free port above
4200.

`probe.mjs` binds **127.0.0.1:4291**, one above the benchmark, so a probe and a
benchmark can run back to back without either inheriting the other's server. It
refuses a busy port the same way.

### The development probe

```bash
node benchmarks/probe.mjs --script <file.mjs> [--no-build] [--headed]
```

`runner.mjs` measures timings from a production bundle, because that is what
users ship. It therefore cannot see a single one of the framework's own
structural counters: `client-runtime/devperf.js` is dev-only by construction and
esbuild removes it from a production build outright, so `renders`,
`wastedRenders`, `domMutations`, `componentPropBailouts` and the **D121 loop
detector** simply do not exist there.

`probe.mjs` builds the same staged copy in development mode and hands a
Playwright `page` to a script that default-exports
`async ({ page, log }) => result`. It refuses to run if the built bundle carries
no `__PUZZLE_PERF__` sentinel, because a dev probe over a production bundle would
report a fabricated zero for every counter it exists to collect.

**Its milliseconds are worthless and must never be quoted as performance
numbers.** Counters are the payload. This is how `loop-trap` is exercised — that
scenario is not in the op matrix at all, because in the harness's own bundle
there would be no detector to detect anything.

It writes to the same `benchmarks/.build/stress-src` and, like the runner, never
touches `examples/stress/dist`.

### Flags

```
--filter <substr>     run only ops whose id contains <substr>
--iterations <n>      override the recorded iteration count
--no-build            reuse the staged bundle
--headed              run a visible browser
--build-mode <mode>   production (default) | development — see below
--list                print every op id
```

Two combinations are refused outright rather than producing a plausible-looking
file:

- **`--update-baseline` with `--filter`.** The baseline is written *whole*, so a
  filtered run would delete every op it did not measure — and the loss is
  invisible afterwards, because a missing baseline entry has nothing to compare
  against and reports no drift. Re-run the full suite to update.
- **`--update-baseline` with `--build-mode development`.** A dev-build baseline
  would enshrine the distortion the harness exists to avoid.

`--no-build` is also checked rather than trusted: both build modes stage to the
same directory, so the runner re-greps the staged `app.js` for dev markers and
refuses to measure a leftover development bundle as production.

---

## Methodology

### 1. Production build, served statically

The example's source is copied into `benchmarks/.build/stress-src`, built there
with `--mode production`, and served from that copy's `dist/` by a small static
server in `runner.mjs`. The dev server is never involved and the example's own
`dist/` is never touched.

The runner does not trust the `--mode` flag; it greps the emitted bundle for
`__PUZZLE_DEVTOOLS_HOOK__`, `import.meta.hot` and `puzzle:hmr` and refuses to
run if a production build contains any of them. It also snapshots `dist/` before
serving, so a rebuild in another terminal cannot change the bytes mid-suite.

For the record, at 0.8.0 the production bundle is **238.6 KB** against the dev
build's **690.4 KB**, and contains zero occurrences of the DevTools hook, HMR,
devstate, or `console.log`. Both are the whole stress lab (every scenario in one
app), not a representative app; `npm run measure:size` owns the real-app
figures.

### 2. Warmup, then 15 recorded iterations, reported as medians

Each scenario's own `warmup()` cycle runs once per group, then 3 untimed
iterations of the real op, then 15 recorded ones. **Medians, never means** — one
GC pause ruins a mean and leaves a median untouched.

Alongside every median the table prints **MAD%** (median absolute deviation as a
percentage of the median), the robust companion to a median. Quoting a standard
deviation next to a median would describe a distribution nobody is reporting.

No op is capped. If one ever is, the runner prints a `CAP` line in the LOG
section and the table's `it` column shows the real count.

### 3. Every iteration is prepared, and `validate()` gates the timed window

**Every create iteration starts from a genuinely empty list, and the harness
proves it rather than assuming it.**

`create-1k/10k/50k` map to `RowOps.freshSeed()`, which clears the collection and
then seeds it. Run back to back, iteration 2 pays a teardown iteration 1 did
not, and "create" quietly becomes "replace". Worse, `freshSeed()` **rewinds the
deterministic fixture seed**, so the regenerated rows carry the same record ids
and the same content as the ones already on screen. Keyed reconciliation matches
them and patches almost nothing: measured with 1,000 rows already present,
`create-1k` produced **1,001 of 1,003 renders wasted and only 95 DOM
mutations**. It still renders correctly, so `validate()` passes and the number
looks entirely plausible — it is a no-op patch wearing a create's name.

So every recorded iteration is preceded by **untimed** prepare ops that restore
the precondition exactly — `clear` before a create, `clear` + `create-Nk` before
a mutation — and each op declares a `preExpect` that is asserted against the
prepared state before the timed window opens (`records: 0` for every create,
`records: N` for every mutation). Deleting the `clear` from a create's prepare
fails the op with `records is 1000, expected 0. The op would not be measuring
what its name says.` rather than quietly reporting a fast create.

`validate()` then runs **before** the timed op (the gate: never benchmark a
broken render) **and after** it (did the op actually do what it claimed?). A
failure at either point records the op as `FAILED` and moves on; nothing is
silently skipped. The prepare cost is real, is in no reported number, and is why
the 50k rows cost about twice their measured time in wall clock.

### 4. The renderer is proven un-throttled before any number is believed

Chrome clamps `setTimeout` to ~1000ms and rAF to ~1Hz in a backgrounded or
occluded renderer. Puzzle schedules **both** store flushes and view renders on
rAF, so a throttled tab does not produce slightly-slow numbers — it produces
numbers quantized to whole seconds. That signature has already fooled one
measurement in this project.

Four independent defences:

1. Chromium launches with `--disable-background-timer-throttling`,
   `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`.
2. `document.visibilityState` must be `visible`.
3. A calibration probe measures 10 real frames (must be under 100ms/frame) and a
   `setTimeout(50)` (must be under 250ms). Both are printed in the report header
   — a healthy run reads `frame 7.4ms · sleep(50) measured 51.0ms`.
4. Every recorded sample set is screened for whole-second clustering: if 60% or
   more of its samples sit within 60ms of a positive multiple of 1000ms, the set
   is **rejected loudly** and the run exits non-zero.

Guard 4 is why `async-waterfall` runs at `delay=35`, not the example's default
of 50. Twenty serialized cells at 50ms land at ~1000ms — indistinguishable from
a single clamped timer, i.e. exactly the artifact the guard exists to catch. At
35ms they land at ~700ms, and a genuinely clamped run would read ~20,000ms.
The verdict itself comes from the in-page concurrency census (`maxInFlight`),
never from the clock.

### 5. Script time is separated from paint

Two independent sources, which is the only way to find out that a number is
wrong:

**In-page** (`scriptMs`, `paintMs`) — the stress app measures around the
synchronous `store.flush()` and then again past the committed frame. `script` is
mutation plus reconciliation with no scheduler slack; `paint` is total elapsed
to the frame the user can see, script included.

**CDP** (`Performance.getMetrics` deltas across the op) — the renderer's own
accounting, reported as `task` / `layout` / `style` / `other`.

> **`ScriptDuration` is deliberately not reported.** Blink's bucket does not
> account for this work: on a `create-10k` costing **182.9ms** of measured
> in-page script it reported **2.91ms**, while `LayoutDuration` (144ms),
> `RecalcStyleDuration` (90.7ms) and `TaskDuration` (491.6ms — against 472ms of
> wall time) all came back correct. The framework's own JavaScript lands in
> `TaskOtherDuration`. Reporting `ScriptDuration` would have stated that
> Puzzle's JavaScript is essentially free, which is the opposite of true.
> The table's `other` column is `task - layout - style` and is the honest
> stand-in.

A related trap, fixed in `callRunTimed()`: work driven by `page.evaluate` runs in
a CDP-injected task the renderer does not attribute at all. The timed op is
therefore kicked off from a `setTimeout(0)` so it lands in an ordinary page task.

`HeapProfiler.collectGarbage` forces a full GC before every timed iteration, so
no iteration absorbs a collection its predecessors earned.

`Tracing.start`/`Tracing.end` was evaluated and **not** used: a trace per
iteration is tens of megabytes at 50k rows across ~450 recorded iterations, and
`Performance.getMetrics` deltas answer the script-versus-paint question at a
fraction of the cost. Reach for tracing when you need a flame chart, not a
number.

### 6. Structural counters are asserted; timings never are

`mountedNodes`, `views` and `records` are deterministic — the same op over the
same seeded data always produces the same counts. They are hard-asserted four
ways: `preExpect` against the prepared state before the timed window, `expect`
against the result after it, per-scenario `invariant` functions, and an exact
comparison against `baseline.json`.

Two invariants carry most of the weight:

- **keyed-list:** `mountedNodes === records * 7` (every row is 7 elements).
- **virtual-list:** `mountedNodes <= 200`. The window is 25 rows — 25 x 7 + 2
  spacers = 177 — so live DOM must not grow with the record count. This is the
  single assertion that catches "windowing broke".

The two behavioural scenarios report their finding only in `run()`'s
human-readable `detail` string, so the runner parses `notified/watchers` and
`maxInFlight/cells/verdict` out of it. Parsing prose is normally a smell; here
the alternative is asserting nothing about the two most interesting results in
the suite, and a parse failure is immediately visible because the counter goes
missing and the `expect` check fails.

### 7. Exit status

Non-zero **only** for a `validate()` failure, a structural-counter mismatch, an
op that threw or timed out, a rejected (throttle-clamped) sample set, or an
**uncaught page error**. A run that exits non-zero also refuses to write
`baseline.json` under `--update-baseline` — a partial or broken run must not
enshrine itself as the reference.

An uncaught page error is a `pageerror` event: an exception nothing in the page
caught, which means the app being measured broke and the numbers around it are
not describing working code.

A `console.error` is **not** an uncaught page error and does not affect the exit
code. Puzzle's runtime logs `console.error` from recovery paths the scenarios
exercise deliberately, so gating on it would redden healthy runs — which is how
such a gate ends up disabled. Console errors are collected and printed in the
`LOG` section instead.

**Never for a timing regression.** Timing on a developer laptop is noise; this
is a local instrument, not a CI gate. The `Δscript`/`Δpaint` columns are for
your eyes only.

---

## How to read the output

| column | meaning |
| --- | --- |
| `it` | recorded iterations actually used |
| `script ms` | median in-page mutation + reconciliation, no scheduler slack |
| `±` | MAD% — above ~10% the sample set is too noisy to read small deltas from |
| `paint ms` | median total elapsed to the committed frame (**includes** script) |
| `live nodes` | `stats().mountedNodes` — DOM elements under the list container |
| `Δscript` / `Δpaint` | percent change against `baseline.json`. Display only. `flr` means one side is at the measurement floor, where a percentage would be theatre. |

The `LOG` section lists every cap, rejection, resolution-floor warning and note.
Nothing is truncated silently.

---

## Results

Machine of record: Apple M1 Pro (10 cores, 32 GB), darwin-arm64, headless
Chromium 151.0.7922.34, Node v25.1.0, production build (238.6 KB), 15
iterations, medians. This is the committed `baseline.json` for 0.8.0, frozen as
`history/0.8.0.json`.

Only the three D170 gate ops (`keyed-list/update-one`, `update-all`,
`reorder`) arm a `MutationObserver` over the list body inside the timed window.
It feeds `klRowsTouched`, the gate their expects assert. Every other
`keyed-list` op, the handler A/B arms included, runs unobserved, as it did in
0.6.0's and 0.7.0's stress example, because an observer inside the timed window
inflates create and clear ([What the numbers say](#what-the-numbers-say) prices it).

### keyed-list, every row mounted

| op | script ms | paint ms | layout ms | live nodes | views | records |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `create/1000` | 25.6 | 61.2 | 16.6 | 7,000 | 1,001 | 1,000 |
| `update-every-10th/1000` | 3.00 | 11.6 | 1.45 | 7,000 | 1,001 | 1,000 |
| `swap-rows/1000` | 5.40 | 38.9 | 15.6 | 7,000 | 1,001 | 1,000 |
| `clear/1000` | 7.40 | 8.30 | 0.12 | 0 | 1 | 0 |
| `create/10000` | **216** | **516** | 144 | 70,000 | 10,001 | 10,000 |
| `update-every-10th/10000` | 23.7 | 59.3 | 15.1 | 70,000 | 10,001 | 10,000 |
| `swap-rows/10000` | 16.0 | 91.1 | 28.3 | 70,000 | 10,001 | 10,000 |
| `clear/10000` | 67.1 | 68.1 | 0.13 | 0 | 1 | 0 |
| `create/50000` | 1023 | 2485 | 673 | 350,000 | 50,001 | 50,000 |
| `update-every-10th/50000` | 124 | 369 | 84.8 | 350,000 | 50,001 | 50,000 |
| `swap-rows/50000` | 61.0 | 280 | 50.0 | 350,000 | 50,001 | 50,000 |
| `clear/50000` | 333 | 334 | 0.13 | 0 | 1 | 0 |

The three D170 gate ops, all at 1,000 rows: `update-one` 1.50ms script (one row
touched, one child `data()` run), `update-all` 9.90ms (1,000 and 1,000),
`reorder` 6.10ms (zero rows touched, zero `data()` runs, moves only).

### virtual-list, same records, same row component, windowed

| op | script ms | paint ms | layout ms | live nodes | views | records |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `create/1000` | 10.8 | 12.8 | 0.45 | 177 | 26 | 1,000 |
| `update-every-10th/1000` | 0.60 | 1.60 | 0.13 | 177 | 26 | 1,000 |
| `swap-rows/1000` | 0.30 | 1.40 | 0.11 | 177 | 26 | 1,000 |
| `clear/1000` | 2.30 | 3.30 | 0.15 | 2 | 1 | 0 |
| `create/10000` | **85.5** | **87.6** | 0.43 | 177 | 26 | 10,000 |
| `update-every-10th/10000` | 3.70 | 4.70 | 0.13 | 177 | 26 | 10,000 |
| `swap-rows/10000` | 0.40 | 1.50 | 0.11 | 177 | 26 | 10,000 |
| `clear/10000` | 20.7 | 21.5 | 0.13 | 2 | 1 | 0 |
| `create/50000` | 429 | 431 | 0.43 | 177 | 26 | 50,000 |
| `update-every-10th/50000` | 15.1 | 16.2 | 0.14 | 177 | 26 | 50,000 |
| `swap-rows/50000` | 1.10 | 2.20 | 0.12 | 177 | 26 | 50,000 |
| `clear/50000` | 107 | 108 | 0.13 | 2 | 1 | 0 |
| `fast-scroll/50000` | 75.0 | 83.3 | 3.71 | 177 | 26 | 50,000 |

### Behavioural scenarios

| op | script ms | paint ms | counters |
| --- | ---: | ---: | --- |
| `subscriptions/update-one/precision` | 0.10 | 0.20 | notified **0** / 100 watchers |
| `subscriptions/update-one/fanout` | 2.90 | 4.60 | notified **100** / 100 watchers |
| `async-waterfall/remount/20` | — | 751 | maxInFlight **1** of 20, **SERIALIZED** |

`async-waterfall` reports no `scriptMs`; the scenario measures wall time and a
concurrency census, not a synchronous flush.

### Across releases

`benchmarks/history/` holds one snapshot per release, and `npm run
bench:history` prints this table from them. **The columns are comparable only
because every snapshot was measured on the same machine (Apple M1 Pro) and the
same headless Chromium (151.0.7922.34).** A snapshot from another machine or
browser is a different instrument; `bench:history` prints both per column and
warns when they disagree.

0.6.0 and 0.7.0 were measured retroactively on 2026-09-30, each by its own tag's
harness and compiler in a temporary checkout. 0.8.0 is the release baseline,
re-measured on 2026-10-01 after the stress observer left the timed window.
Median script ms / paint ms, full-DOM `keyed-list` unless noted:

| op | 0.6.0 | 0.7.0 | 0.8.0 |
| --- | ---: | ---: | ---: |
| `create/1000` | 21.2 / 51.3 | 23.6 / 57.9 | 25.6 / 61.2 |
| `update-every-10th/1000` | 5.70 / 9.60 | 6.60 / 15.0 | **3.00** / 11.6 |
| `swap-rows/1000` | 10.0 / 38.0 | 11.6 / 44.9 | **5.40** / 38.9 |
| `clear/1000` | 6.10 / 6.90 | 6.80 / 7.70 | 7.40 / 8.30 |
| `create/10000` | 175 / 447 | 198 / 484 | 216 / 516 |
| `update-every-10th/10000` | 52.8 / 98.5 | 69.6 / 116 | **23.7** / 59.3 |
| `swap-rows/10000` | 53.3 / 127 | 68.3 / 139 | **16.0** / 91.1 |
| `clear/10000` | 49.7 / 50.7 | 61.2 / 62.1 | 67.1 / 68.1 |
| stress: `create/50000` | 859 / 2248 | 980 / 2402 | 1023 / 2485 |
| stress: `clear/50000` | 264 / 265 | 329 / 330 | 333 / 334 |
| stress: windowed `create/50000` | 373 / 375 | 430 / 433 | 429 / 431 |
| `async-waterfall` census | 1 of 20 in flight, 751ms | 1 of 20, 749ms | 1 of 20, 751ms |
| stress-lab bundle | 218.7 KB | 229.5 KB | 238.6 KB |

Ops per version: 0.6.0 and 0.7.0 run the same 80-op matrix, and each snapshot
holds 79 of them. `route-churn/navigate-burst/100` is missing from both because
the tag's own scenario declares `rcAncestorMutations: 500` while the tag measures
700; the expect was stale at both tags (0.8.0 declares 700), and the runner
records no timings for a mismatched op. 0.8.0 adds the three D170 gate ops
(`keyed-list/update-one`, `update-all`, `reorder`) for 83. Every counter the two
old runs did record matches its tag's own `baseline.json`.

**At each release,** on the clean release tree: `npm run bench:update`, then
`npm run bench:snapshot`. The snapshot refuses a baseline measured over
uncommitted changes. Only compare a new column with the old ones if it was
measured on this machine and browser; otherwise re-measure the old tags with
their own harnesses (a temporary `git worktree` per tag, `npm run
build:compiler`, `npm ci`, `npm run bench`, and take `benchmarks/.last-run.json`).

### What the numbers say

**D170 made changing an existing list 2–4x cheaper in script time.** Against
0.7.0 at 10,000 rows, `update-every-10th` went from 69.6ms to 23.7ms and
`swap-rows` from 68.3ms to 16.0ms; at 1,000 rows, 6.60ms to 3.00ms and 11.6ms to
5.40ms. The counters say why: 0.7.0 re-ran all 10,000 child `data()` calls for
either op, 0.8.0 re-runs the 1,000 rows it wrote and none for a swap. An
untouched row now comes back from its list block as the same cached subtree and
the patcher short-circuits on identity, and the row's handlers are cached on
the row scope, so nothing hands the child a fresh prop. Paint improves less
(116ms to 59.3ms, 139ms to 91.1ms at 10,000) because layout of the rows that did
change is the browser's work and did not move.

**Creating and clearing a full-DOM list got slower in 0.7.0, and 0.8.0 reads
slightly slower again, at the edge of noise.** Against 0.7.0, a 1,000-row create
costs 2.0ms more script (23.6ms to 25.6ms) and a clear 0.6ms more (6.80ms to
7.40ms); at 10,000, create is 18ms slower (198ms to 216ms) and clear 5.9ms
(61.2ms to 67.1ms). That is +8% to +10% at both sizes. At 50,000 the step
shrinks to +4% on create (980ms to 1023ms) and +1% on clear (329ms to 333ms).
Every one of these sits inside the ~18% run-to-run band below, so none of them
is a finding alone. Against 0.6.0 the 1,000-row create is 4.4ms (+21%) slower,
2.4ms of it the 0.7.0 step.

- **The instrument is no longer part of it.** Earlier 0.8.0 runs armed the
  stress example's `MutationObserver` inside the timed window of every
  `keyed-list` op, and the 0.6.0 and 0.7.0 stress apps had no observer. A
  bracketed A/B (observer on, off, on) priced it at 0.4ms, 3.2ms and 69ms of
  script on the 1,000, 10,000 and 50,000-row creates, and 0.6ms, 5.1ms and 21ms
  on the clears. It now arms only for the three D170 gate ops that assert its
  counts, which have no 0.6.0 or 0.7.0 column, so every op in the table above
  compares like for like.
- **The remaining step is not stable within one run.** The `handlers-inline`
  arm runs the same URL and render path as `keyed-list` in the same suite, and
  its creates read 22.5ms and 202ms at 1,000 and 10,000 rows: level with 0.7.0's
  same arm (22.2ms and 207ms). Two identical ops disagreeing by 12% in one run
  is the band at work. If the step is real, the likely cause is D170's per-row
  state. The card lists what a list block keeps for every row: a live scope
  object, the stored record revision, the cached vnode subtree, per-row static
  caches and handler slots, plus a `__propRevs` snapshot per child and a
  render-revision Symbol defined on every record at `_instantiate`. A create
  builds all of it and a clear tears it down; a later update or swap is where
  it pays back. The card does not price these costs and this harness does not
  separate them.
- **The 0.7.0 step predates D170** and hit the windowed list as well: its
  `create/50000`, which is mostly store seeding and mounts 26 views, rose from
  373ms to 430ms, and its `clear/50000` from 47.7ms to 116ms. That points at
  store-side work rather than rendering. No decision card prices it.

**Views that re-render one big template gained nothing and pay the new
bookkeeping.** Against 0.7.0, `islands/shell-renders` went from 576ms to 629ms
(+9%), the `formatters` re-renders by 4–9%, and `form-state` typing (200
controlled fields, a full re-render per keystroke) by 17–18%. Only the typing
step reaches the edge of the ~18% band, but every one of them points the same
way, and the two earlier 0.8.0 runs read higher still (+14%, 7–12% and 18–28%). These views have no keyed row list for the cache to skip. The likely cost
is the machinery D170 gives every view, which the card lists (the `__dirty` root
mask, static-subtree cache reads, the `__propRevs` compare, `syncControl`
re-asserting controlled values); this harness does not separate the parts.
The `listener-churn` churn arm moves the other way (855ms to 544ms at 10,000),
because its `@click={ selectRow(row) }` is now cached on the row.

**Windowing removes the DOM cost, not the data cost.** At 10,000 records
`create` is 216ms full-DOM against 85.5ms windowed, and the windowed list still
pays those 85.5ms because seeding 10,000 records is shared by both strategies.
The difference is what 70,000 elements and 10,001 view instances cost. Layout
makes it stark: 144ms full-DOM against **0.43ms** windowed, flat from 1k to 50k.

**Paint dominates at scale, and it is the browser's cost, not the
framework's.** `keyed-list/create/10000` is 216ms of script inside 516ms to the
painted frame. A single number would hide that more than half of the wait is
the engine, and no reconciler tuning would recover it.

**Ops touching only rendered rows are effectively free when windowed.**
`swap-rows` at 10,000: 16.0ms full-DOM, 0.40ms windowed (at the measurement
floor). `update-every-10th`: 23.7ms against 3.70ms.

**`clear` is pure teardown and scales with what is being torn down**: 67.1ms at
10,000 full-DOM against 20.7ms windowed, with layout at ~0.13ms in both. That is
destructor and store work, not rendering.

**Subscription precision holds in production.** One write outside the watched
window wakes 0 of 100 precision watchers and 100 of 100 fan-out watchers. The
precision timing is at the measurement floor, not a real value.

**The async `data()` serialization is real in production, in every release
measured.** 20 independent async `data()` evaluations, nothing shared, nothing
queried: `maxInFlight` is 1 in 0.6.0, 0.7.0 and 0.8.0.
`Store.withTracking`'s single store-wide `_asyncTrackingChain` defers each
known-async evaluation behind the one in flight. This is a census result, not a
timing inference.

---

## The handler A/B

One question, and it is not a timing question: **is `keyed-list`'s per-row
re-render cascade a framework problem or an example-written-badly problem?**

Both arms run the same scenario, the same records, the same row component and
the same ops. The only difference is how `KeyedList` spells its two callback
props.

- **`inline`**, the default and what `baseline.json` is recorded from, passes
  data-capturing props: `@select={ selectRow(row) }`. Before D170, `row` being a
  loop variable meant codegen could not cache the closure (D62) and minted a
  fresh arrow per row per parent render. Those arrows are component **props**,
  so they take part in `patchComponent`'s `shallowEqual(oldProps, newProps)`
  bailout (`client-runtime/views/viewManager.js`), and a fresh function object
  never compares equal. Every mounted row re-ran `data()` and re-rendered on
  every parent render, however little changed.
- **`stable`** passes bare method references: `@select={ selectById }`. Those
  *are* cacheable, so codegen emits `((this.__h ??= {})[N] ??= ...)`: one
  function object per site per view instance, identical across renders. An
  untouched row's props then compare fully equal and `applyParentUpdate()`
  returns without running `data()` and without rendering.

**Since D170 (0.8.0) the `inline` arm no longer mints fresh arrows.** A handler
whose arguments capture only loop locals is cached on the row scope
(`s.h0 ??= (event) => this.events.selectRow(s.item)`) and reads the row's
current item when it fires, and an untouched row comes back from the list block
as the same cached subtree, so the patcher never compares its props at all. The
cascade the A/B was built to price is gone from both spellings; the measurements
below show that, next to 0.7.0's, which still priced it.

The row capture has to go somewhere, and in `stable` it moves **into the child**:
`ListRow` calls `props.select?.(props.id)` and the parent re-queries by id. That
is the entire difference. `ListRow` is shared with `virtual-list`, which is
unaffected; the inline closure simply ignores the extra id argument.

### Running it

`--filter handlers-` runs only this comparison: 20 entries appended to the end of
`OPS`, with ids `handlers-inline/*` and `handlers-stable/*`. The existing
`keyed-list/*` and `virtual-list/*` ids and params are untouched, and the
`inline` arm deliberately does **not** pass `handlers=inline`. It is the
default, so that arm's URL, render path and counters are identical to the plain
`keyed-list/*` entries the committed baseline came from.

The arms are ordered so each pair is adjacent in one browser session, at the same
iteration count, with the same forced GC between iterations. Reinterpreting
numbers gathered elsewhere in a run would fold in whatever drifted in between.

**It takes two runs, and their outputs must never be mixed.** Timings come from
the default production build. The structural counters come from
`--build-mode development`, because `renders`, `wastedRenders`, `propBailouts`,
`propReruns` and `domMutations` are produced by `client-runtime/devperf.js`,
which production compiles out; the RENDER STRUCTURE table prints them as `—`
rather than `0` in a production run, because a fabricated zero and a measured
zero mean opposite things here. `childDataRuns` is the exception: it is a plain
integer in `examples/stress/app/row-metrics.js`, incremented at the top of
`ListRow.data()`, so it survives into the shipped bundle and is present in every
build. The table's `handlers` column is reported by the scenario itself, so an
arm cannot be mislabelled. **Never quote a development run's milliseconds.**

### The behaviour gates

A variant that is faster because it quietly stopped working is worthless, so each
arm must prove it still works before any of its numbers are believed.
`click-select` and `click-remove` are **behaviour gates, not measurements**: they
dispatch a real DOM click at the first rendered row and throw unless the
selection actually flipped (in the store *and* in the DOM) and unless that
exact record left both the store and the DOM. They run first within each arm, at
one iteration with no warmup; a throw is reported as `ERROR` and fails the run.
Their milliseconds mean nothing. **Both arms pass, in 0.7.0 and in 0.8.0.**

### The timings

Production build, 15 recorded iterations, medians, same machine and Chromium
151 for both releases: 0.7.0 from its retroactive run (`history/0.7.0.json`),
0.8.0 from the committed baseline. Median in-page `script ms`:

| op | n | 0.7.0 `inline` | 0.7.0 `stable` | 0.8.0 `inline` | 0.8.0 `stable` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `create` | 1,000 | 22.2 | 21.9 | 22.5 | 22.2 |
| `update-every-10th` | 1,000 | 6.80 | 3.30 | 2.90 | 2.80 |
| `swap-rows` | 1,000 | 10.6 | 5.40 | 4.50 | 4.40 |
| `select-row` | 1,000 | 6.40 | 2.20 | 1.40 | 1.50 |
| `create` | 10,000 | 207 | 204 | 202 | 203 |
| `update-every-10th` | 10,000 | 62.1 | 27.1 | 22.5 | 22.2 |
| `swap-rows` | 10,000 | 62.8 | 21.8 | 15.9 | 16.3 |
| `select-row` | 10,000 | 58.0 | 17.6 | 12.2 | 12.2 |

CDP `task ms` at 10,000 rows, the renderer's own accounting, as the independent
second opinion:

| op | 0.7.0 `inline` | 0.7.0 `stable` | 0.8.0 `inline` | 0.8.0 `stable` |
| --- | ---: | ---: | ---: | ---: |
| `create` | 501 | 496 | 486 | 488 |
| `update-every-10th` | 139 | 64.0 | 59.4 | 60.1 |
| `swap-rows` | 162 | 108 | 103 | 103 |
| `select-row` | 99.7 | 29.6 | 23.6 | 24.5 |

**Read the 10,000-row rows.** At 1,000 rows most figures sit under the 5ms mark
below which [Instrument variance](#instrument-variance) says a delta is not worth
trusting. In 0.7.0 the stable spelling cut every mutation of a 10,000-row list
by more than half. In 0.8.0 the two arms are within noise of each other on every
op, and in script time the inline arm now matches or beats what the stable
spelling achieved in 0.7.0. CDP task time agrees: at 10,000 rows both 0.8.0
arms sit at or below 0.7.0's stable arm on every op (the earlier runs, with the
observer in the window, read `update-every-10th` and `swap-rows` 10–17% above
it). `create` cannot bail out on first mount in any arm,
so it only moves with the create cost discussed under [What the numbers say](#what-the-numbers-say).

### The structural counts: the decisive evidence

Development build, n=10,000. These are exact counts, not medians: they are
properties of the render algorithm, not of the machine.

At 0.8.0:

| op | arm | childDataRuns | renders | wastedRenders | propBailouts | propReruns | domMutations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `create` | `inline` | 10,000 | 10,001 | 0 | 0 | 0 | 220,004 |
| `create` | `stable` | 10,000 | 10,001 | 0 | 0 | 0 | 220,004 |
| `update-every-10th` | `inline` | 1,000 | 1,001 | 1 | 0 | 1,000 | 2,000 |
| `update-every-10th` | `stable` | 1,000 | 1,002 | 1 | 1 | 1,000 | 2,005 |
| `swap-rows` | `inline` | 0 | 1 | 0 | 2 | 0 | 997 |
| `swap-rows` | `stable` | 0 | 1 | 0 | 2 | 0 | 997 |
| `select-row` | `inline` | 1 | 2 | 1 | 0 | 1 | 1 |
| `select-row` | `stable` | 1 | 2 | 1 | 0 | 1 | 1 |

Measured before D170 (exact counts, so the machine does not matter):

| op | arm | childDataRuns | renders | wastedRenders | propBailouts | propReruns | domMutations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `update-every-10th` | `inline` | 10,000 | 10,001 | 9,001 | 0 | 10,000 | 2,000 |
| `update-every-10th` | `stable` | 1,000 | 1,001 | 1 | 9,000 | 1,000 | 2,000 |
| `swap-rows` | `inline` | 10,000 | 10,001 | 10,000 | 0 | 10,000 | 997 |
| `swap-rows` | `stable` | 0 | 1 | 0 | 10,000 | 0 | 997 |
| `select-row` | `inline` | 10,000 | 10,001 | 10,000 | 0 | 10,000 | 1 |
| `select-row` | `stable` | 1 | 2 | 1 | 9,999 | 1 | 1 |

**The DOM work is identical in every row of both tables.** `domMutations` is
2,000 for `update-every-10th`, 997 for `swap-rows` and 1 for `select-row`,
whichever arm, whichever release. No arm is skipping work the user can see.

**Before D170 the inline idiom defeated the bailout**: 10,000 child `data()`
runs, ~10,000 wasted renders and zero bailouts on every op, whether it touched
1,000 rows or one, while the stable arm bailed out of every untouched row.
**At 0.8.0 both arms do only the work the op asked for**: 1,000 child `data()`
runs for 1,000 written rows, none for a swap, one for a select. `propBailouts`
also falls from ~10,000 to ~0 in the stable arm. The rows are no longer bailing
out of a prop comparison; they are never compared, because the list block hands
back the cached subtree and `patch()` short-circuits on identity.

A stray render or a few mutations of difference between arms (`update-every-10th`
above: 1,002 against 1,001, 2,005 against 2,000) is the control panel, not the
list: `Home` polls `scenarioStats()` on a 1s interval and suppresses it only
while its OWN buttons are driving an op, so a harness-driven op can have the
poll land inside the measured window and repaint the stat readouts. Treat the
framework counters as exact to within about one render for this reason;
`childDataRuns` counts only `ListRow.data()` and is exact, full stop.

So the cascade was never a defect in the bailout. `patchComponent`'s
`shallowEqual` was correct and, given stable props, effective; the canonical list
idiom disarmed it by handing the patcher a new function object per row per
render, and D170 fixed that in the compiler rather than in the idiom. It does not
overturn the windowing result either: `create`, the op windowing wins hardest
on, is the one op no handler spelling can help.

---

## Route churn: what a committed navigation costs a reused ancestor

Two ops, `route-churn/navigate-burst/100` and `route-churn/params-burst/100`.
The full derivation, the per-level table and the mechanism live in
`examples/stress/README.md`; this section covers what belongs to the harness.

**Only the UNPACED arms are in the matrix, and that is a measurement decision
rather than a stylistic one.** `route-churn`'s other ops run at a fixed
navigations-per-second, so their duration is an input; worse, a 100-navigation
op at 5/sec lands on 20,000ms, and guard 4 (whole-second clustering) would
rightly reject it. The paced arms exist because a **development** build's D121
runaway-render detector fires on fast navigation over a deep route tree.
Production has no detector, so the burst arms are both safe and honest here.

0.8.0, production, 15 iterations:

| op | script ms | paint ms | task | other | live nodes | views |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `navigate-burst/100` | — | **27.6** | 30.3 | 24.5 | 20 | 7 |
| `params-burst/100` | — | **16.3** | 20.0 | 16.7 | 20 | 7 |

Both report no `scriptMs`: a navigation is not a synchronous flush, so the
scenario measures wall time around the whole loop, exactly as `async-waterfall`
does. 0.7.0 on the same machine and browser measured `params-burst` at 18.0ms;
its `navigate-burst` has no timing (see [Across releases](#across-releases)).

That is 0.28ms per leaf-divergence navigation against 0.16ms for the params-only
control. The ancestors here render one span and a `<Slot/>`, so the time says
little on its own; the counters are the finding, and a real app's layouts
multiply them by whatever they do per render.

The asserted counters are exact rather than statistical, properties of the
router and not of the machine:

| counter | `navigate-burst` | `params-burst` | before D170 |
| --- | ---: | ---: | --- |
| `rcAncestorRenders` | **1,200** (12/nav) | **600** (6/nav) | 2,700 / 2,100 |
| `rcAncestorDataRuns` | 600 (6/nav) | 600 (6/nav) | unchanged |
| `rcAncestorMutations` | 700, all at the divergence level | **0** | unchanged |
| `rcLayoutRenders` | 200 (2/nav) | 100 (1/nav) | unchanged |
| `rcLeafMounts` | 100 | **0**, the leaf instance is reused | unchanged |

D170 took the reused-ancestor cascade from 27 renders per navigation to 12,
O(depth) instead of O(depth²): the record-prop and identity bailouts now stop it
instead of letting it re-render every slot-holding descendant. `rcAncestorMutations` is 700 in 0.6.0, 0.7.0
and 0.8.0 alike; the 500 this README used to quote was a stale expect in
`scenarios.mjs`, not a measurement.

`rcLeafMounts` is the assertion that keeps the control honest: if the
params-only arm ever remounted its leaf it would not be a params-only arm.

## Listener churn: pricing the invoker pattern

Three arms over identical DOM: `churn`, `stable`, `none`. `rerender` is the
uninstrumented timing arm; `count-listeners` is the same 20 renders with
`Element.prototype`'s `addEventListener`/`removeEventListener` patched **by the
scenario**, so its counts are exact and its milliseconds carry the probe. The
two must never be compared across, the same split `formatters` uses for
`count-intl`.

Production medians of 15, 20 renders per op, uninstrumented arm, same machine
and Chromium 151 for both releases:

| n | release | `churn` | `stable` | `none` | churn − stable |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | 0.7.0 | 72.5 | 50.4 | 43.5 | **22.1ms (30.5%)** |
| 10,000 | 0.7.0 | 855 | 542 | 505 | **313ms (36.6%)** |
| 1,000 | 0.8.0 | 51.8 | 51.2 | 51.0 | 0.6ms, noise |
| 10,000 | 0.8.0 | 570 | 564 | 583 | 6ms, noise |

Structural counts over 20 renders of 10,000 rows:

| arm | before D170: add / remove | 0.8.0: add / remove |
| --- | ---: | ---: |
| `churn` | 400,000 / 400,000 (40,000 per render) | **0** / **0** |
| `stable` | **0** / **0** | **0** / **0** |
| `none` | **0** / **0** | **0** / **0** |

The committed baseline gates on the zeros. Since D170 the `churn` arm's
`@click={ selectRow(row) }` is cached on the row scope, so all three arms
rebind nothing and time the same; `none` reading a little slower than the other
two at 10,000 is inside the run-to-run band.

**The canonical Puzzle handler spelling rebinds nothing**, and it never did:
`@click={ onSelect }` compiles to a per-instance cached arrow and never fails
`patchAttrs`'s identity check. Since D170 neither does the loop spelling. The
invoker pattern's saving in idiomatic code is therefore exactly 0%.

`probe-listener-churn.mjs` confirms that on `keyed-list` itself, by patching
`Element.prototype` from the driver so no app change is needed (0.8.0):

| `keyed-list/update-every-10th` | child `data()` runs | add | remove |
| --- | ---: | ---: | ---: |
| n=10,000 `handlers=inline` | 1,000 | **0** | **0** |
| n=10,000 `handlers=stable` | 1,000 | **0** | **0** |

Before D170 the inline row re-ran all 10,000 child `data()` calls here and still
rebound no listener.

`micro-listener-cost` prices the parts over the real rendered elements,
batch-timed (per-round timing put the invoker arm under the `performance.now()`
clamp, where it reported a flat 0.0ns, a floor artefact shaped like a result).
0.8.0 probe run, 10,000 elements:

| operation | per handler |
| --- | ---: |
| `removeEventListener` + `addEventListener` | ~215–245ns |
| invoker property write | **~1.2–1.7ns** |
| arrow allocation | ~4ns *(likely understated: escape analysis)* |

So of the 313ms `churn` penalty 0.7.0 paid at 10,000 rows, the DOM API is
~90ms (400,000 remove/add pairs at ~230ns): **~11% of that arm's render time
and under a third of its own penalty**. The rest is the remainder of `setAttr`'s
per-call work (it re-parses the event name on every call, walks the `LISTENERS`
map, stores the handler) plus the closure allocation. **An invoker removes none
of that**: `setAttr` is still entered whenever the handler identity changes;
only the remove/add pair becomes a property write.

**The answer is that it is not worth adopting**, and D170 settled it: the shape
that paid is now compiled to a stable identity, which recovers the whole
penalty, where an invoker would have recovered about a third of it.

`rerender` runs **20** renders, not 30. At 30 the churn arm landed at ~1,095ms
and guard 4 rejected the sample set: 8 of 8 samples within 60ms of a whole
second is indistinguishable from a throttled renderer. 20 puts it under a
second. This is the second time that guard has moved an op's parameters rather
than its verdict; `async-waterfall`'s delay=35 was the first. `count-listeners`
carries a 3-iteration `CAP` (its counts are algorithmic, not statistical).

---

## Production versus development

Same harness, same machine, same headless Chromium 151, 15 iterations,
`--build-mode development --filter create` against the 0.8.0 production
baseline as it stood before the stress observer left the timed window. Both
columns carry the observer, so the pair is matched. The dev bundle is 690.4 KB with `__PUZZLE_DEVTOOLS_HOOK__` present; the
production one is 238.5 KB with it absent.

| op | mounted views | dev script | prod script | Δ abs | Δ % |
| --- | ---: | ---: | ---: | ---: | ---: |
| `keyed-list/create/1000` | 1,001 | 29.0 | 25.6 | +3.4ms | +13.3% |
| `keyed-list/create/10000` | 10,001 | 258 | 218 | +40ms | +18.2% |
| `keyed-list/create/50000` | 50,001 | 1249 | 1091 | **+158ms** | +14.5% |
| `virtual-list/create/1000` | 26 | 10.1 | 10.9 | −0.8ms | −7.3% |
| `virtual-list/create/10000` | 26 | 77.5 | 90.9 | −13ms | −14.7% |
| `virtual-list/create/50000` | 26 | 360 | 444 | **−85ms** | −19.1% |

**Read the absolute column, not the percentage.** On the full-DOM list the dev
build's cost tracks **mounted view count**, and the per-view figure holds across
two orders of magnitude: 3.4ms/1,001 views, 40ms/10,001, 158ms/50,001, about
**3–4 microseconds of dev overhead per mounted view**. That is consistent with
per-view dev registration and the devstate live-view registry, and it matches
what the pre-D170 build measured.

**The windowed create runs faster in the dev build**, and that is new. It
mounts 26 views at every size, so the per-view overhead is negligible, but the
production bundle is slower at the part both builds share, seeding the records.
It reproduces: two more back-to-back production/development pairs of
`virtual-list/create` measured 431 and 439ms production against 360 and 363ms
development at 50,000. Before D170 the dev build was 1–3ms slower here, as
expected. This harness does not say why; the 0.7.0 store-side step under
[What the numbers say](#what-the-numbers-say), which the windowed list also
paid, is the obvious place to look.

The consequence is the same as before, only stronger. Dev-build numbers do not
merely run slow: the penalty lands on the strategy that mounts many views, and
the windowed strategy now runs faster in dev than it ships, so a dev-build A/B
**overstates the case for windowing** at every size.

Structural counters were identical across both builds, as they must be.

---

## Instrument variance

Non-negotiable for a benchmark: run it twice on an unchanged tree and see
whether it can tell itself apart from the framework.

For 0.8.0 this was two full suites on the same framework source (the first on
the release branch head, the second after a harness-only commit that adds
`history/`). Both predate the observer change; the committed baseline is a
third run after it. 83 ops each, 157 comparable medians.

| sample group | median abs. delta | p90 | max |
| --- | ---: | ---: | ---: |
| all comparable medians | 3.8% | 11.1% | 100.0% |
| ops with script median >= 5ms | **3.2%** | **8.3%** | **18.3%** |
| ops with script median < 5ms | 6.6% | 18.7% | 100.0% |

**Detection threshold: on ops above 5ms, treat anything under ~18% as noise.
Sub-5ms ops cannot be compared at all.** The 100% outlier is
`subscriptions/update-one/precision` moving from 0.10ms to 0.00ms, one
`performance.now()` tick wearing a percentage costume. The table prints `flr`
instead of a percentage whenever either side is at the floor, and the LOG
section adds a `FLOOR` line, so these cannot be misread as findings.

This pair is noisier than the pre-D170 one (median 1.4%, max 12.9%), measured
on a machine that was also running other work, and the worst offenders are
long single-view ops: `flip-churn/interrupt` (432ms to 512ms), then
`virtual-list/clear/50000` and a few 10,000-row paint medians at 11–14%. A
single op's delta under ~18% is not a finding. A delta with the same sign and
size across sizes and runs, like the 0.6.0-to-0.7.0 create and clear step
under [What the numbers say](#what-the-numbers-say), is.

Both 0.8.0 suite runs, and the committed baseline run after them: 83/83 ops
`ok`, zero validate failures, zero structural mismatches, zero clamp
rejections, exit 0. Wall time ~13 minutes per suite.

---

## Limitations — what this does not measure

- **One machine, one browser.** Headless Chromium only. No WebKit or Firefox,
  and no cross-machine normalization. `baseline.json` is a reference for *this*
  machine; deltas from anyone else's hardware are meaningless.
- **Headless is not headed.** Raster and compositing differ from a real windowed
  browser. `paint ms` here is "time to committed frame", not perceived latency,
  and `--headed` is available but has not been characterised.
- **No cross-framework comparison.** The `keyed-list` op set follows
  js-framework-benchmark shapes, but the driver, the machine and the
  measurement window all differ. These numbers are **not** comparable to
  published React/Vue/Svelte figures.
- **The absolute numbers are not comparable to `examples/stress/README.md`.**
  Those were hand-run single measurements in a real Chrome window; these are
  harness medians in headless Chromium with a forced GC per iteration. They
  disagree even at the same build mode. That disagreement is the argument for
  having a harness, not a defect in one.
- **No memory-leak detection.** `heap Δ MB` is a single before/after delta
  around one op, not a retention analysis across iterations.
- **Not every stress op is covered.** `replace-all`, `append-1k` and
  `remove-row` exist in the app and are not in the matrix; `select-row` is in it
  only inside the handler A/B arms, never in the main `keyed-list` or
  `virtual-list` groups. `route-churn`'s paced arms (`navigate-100`,
  `params-100`, `back-forward-100`, `supersede-50`) are deliberately absent —
  their durations are inputs and the clamp guard would reject them — so their
  counters come from `probe.mjs` runs instead, and `listener-churn/rerender` is
  the only listener arm timed at both sizes. The two unimplemented scenarios
  in `examples/stress/README.md` obviously are not covered either. Add entries
  to `scenarios.mjs` — nothing else needs to change.
- **History is per-harness.** Each snapshot in `history/` was measured by its
  own release's harness and stress example, so a column is that release as its
  own instrument saw it. Where the instrument changed between releases, the
  table cannot tell it from the framework. 0.8.0's stress example adds a
  `MutationObserver`, but only to the three D170 gate ops, which have no older
  column, so it stays out of every shared op (priced under
  [What the numbers say](#what-the-numbers-say)). Snapshots start at 0.6.0; the
  harness exists at `v0.5.0` too but was not backfilled.
- **Two entries are behaviour gates whose timings mean nothing.**
  `virtual-list/native-scroll` (1 iteration, no warmup) is mostly the frames it
  waits between `scrollTop` writes, and every `flip-churn` arm carries its own
  probe. Read their counters; ignore their milliseconds.
- **`subscriptions` precision timing is unmeasurable**, not zero. It sits under
  the `performance.now()` ~100us clamp.

## Adding an op

Append an entry to `OPS` in `scenarios.mjs`, run `npm run bench --
--filter <your-id>` to check it, then `npm run bench:update` to record it. Keep
`prepare` doing the real work of restoring the precondition, and give it an
`expect` or `invariant` — an op with no structural assertion contributes a
number nobody can falsify.
