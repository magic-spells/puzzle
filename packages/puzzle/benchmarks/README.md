# Puzzle production benchmark

The instrument that measures what users actually ship.

```bash
npm run bench            # measure, print the table, compare against baseline.json
npm run bench:update     # the same, then rewrite baseline.json
```

Every performance number this project had before this harness came from a
**development** build — HMR machinery, the DevTools bridge, per-view dev
registration, unminified code. Those numbers are directionally useful and
nothing more. This harness builds `examples/stress` in production mode, serves
the static output, and drives it through `window.__STRESS__`.

The gap is not hypothetical. Measured through this same harness (see
[Production versus development](#production-versus-development)), the dev build
adds roughly **3–4 microseconds per mounted view** — **+190ms** on a 50k
full-DOM create against **+3ms** on the windowed one. It does not merely shift
the numbers, it distorts the comparison *between* rendering strategies, which is
the comparison the stress lab exists to make.

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
| `probe.mjs` | the mirror image of `runner.mjs`: builds the same staged copy in **development** mode and hands the page to an arbitrary probe script. Counters only — see below. |
| `probe-route-churn.mjs` | per-level render / `data()` / mutation counters for `route-churn`, plus a hard failure if the D121 detector fired |
| `probe-listener-churn.mjs` | exact listener-call counts per arm, and the micro decomposition that prices the invoker pattern |

### Every path this harness writes to

**It writes to exactly two places, both gitignored, both under `benchmarks/`:**

| path | contents |
| --- | --- |
| `benchmarks/.build/stress-src/` | a scratch copy of the example's source (`app/`, `public/`, `puzzle.config.js`, `package.json`) **and its `dist/`** — the bundle actually served |
| `benchmarks/.last-run.json` | the most recent run, so a failed run can still be diffed by hand |

Plus `benchmarks/baseline.json`, but only under `npm run bench:update`.

**It never writes to `examples/stress/dist/`.** That directory belongs to
whoever is running `puzzle dev`, and the benchmark stays out of it. This is not
a stylistic preference — it was a real incident. `puzzle build` has no
output-dir flag (`--fixtures`, `--hybrid`, `--mode`, `--static` is the entire
set), so building the example in place emits `examples/stress/dist` and
overwrites the dev bundle a human's browser is holding open. Because a
production build strips the DevTools bridge by design, their Performance panel
went dead with "No Puzzle app detected" and nothing said why.

So the runner copies the example's source into `benchmarks/.build/stress-src`
and builds the copy. The copy lives inside the repo, so `@magic-spells/puzzle`
still resolves through the root `node_modules` exactly as it does for the
example (`examples/stress` has no `node_modules` of its own). Verified by
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

For the record, the production bundle is **99.4 KB** against the dev build's
**327 KB**, and contains zero occurrences of the DevTools hook, HMR, devstate,
or `console.log`.

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

Machine of record: darwin-arm64, headless Chromium 149.0.7827.55, Node v25.1.0,
production build (99.4 KB), 15 iterations, medians. Reproduced from
`baseline.json`.

### keyed-list — every row mounted

| op | script ms | paint ms | layout ms | live nodes | views | records |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `create/1000` | 19.3 | 49.7 | 17.0 | 7,000 | 1,001 | 1,000 |
| `update-every-10th/1000` | 5.30 | 8.90 | 1.36 | 7,000 | 1,001 | 1,000 |
| `swap-rows/1000` | 9.70 | 38.3 | 15.8 | 7,000 | 1,001 | 1,000 |
| `clear/1000` | 6.00 | 6.80 | 0.12 | 0 | 1 | 0 |
| `create/10000` | 171 | 472 | 148 | 70,000 | 10,001 | 10,000 |
| `update-every-10th/10000` | 49.0 | 101 | 20.0 | 70,000 | 10,001 | 10,000 |
| `swap-rows/10000` | 49.3 | 130 | 29.3 | 70,000 | 10,001 | 10,000 |
| `clear/10000` | 48.0 | 49.0 | 0.11 | 0 | 1 | 0 |
| `create/50000` | **798** | **2198** | 674 | 350,000 | 50,001 | 50,000 |
| `update-every-10th/50000` | 297 | 492 | 72.5 | 350,000 | 50,001 | 50,000 |
| `swap-rows/50000` | 280 | 509 | 50.1 | 350,000 | 50,001 | 50,000 |
| `clear/50000` | 230 | 231 | 0.13 | 0 | 1 | 0 |

### virtual-list — same records, same row component, windowed

| op | script ms | paint ms | layout ms | live nodes | views | records |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `create/1000` | 8.50 | 10.3 | 0.47 | 177 | 26 | 1,000 |
| `update-every-10th/1000` | 0.60 | 1.40 | 0.14 | 177 | 26 | 1,000 |
| `swap-rows/1000` | 0.40 | 1.30 | 0.12 | 177 | 26 | 1,000 |
| `clear/1000` | 1.30 | 2.10 | 0.13 | 2 | 1 | 0 |
| `create/10000` | 68.3 | 70.0 | 0.45 | 177 | 26 | 10,000 |
| `update-every-10th/10000` | 3.10 | 3.90 | 0.13 | 177 | 26 | 10,000 |
| `swap-rows/10000` | 0.50 | 1.30 | 0.11 | 177 | 26 | 10,000 |
| `clear/10000` | 8.50 | 9.20 | 0.13 | 2 | 1 | 0 |
| `create/50000` | **338** | **340** | 0.45 | 177 | 26 | 50,000 |
| `update-every-10th/50000` | 12.6 | 13.4 | 0.13 | 177 | 26 | 50,000 |
| `swap-rows/50000` | 1.10 | 2.00 | 0.12 | 177 | 26 | 50,000 |
| `clear/50000` | 41.2 | 42.2 | 0.14 | 2 | 1 | 0 |
| `fast-scroll/50000` | 73.5 | 82.2 | 3.90 | 177 | 26 | 50,000 |

### Behavioural scenarios

| op | script ms | paint ms | counters |
| --- | ---: | ---: | --- |
| `subscriptions/update-one/precision` | 0.10 | 0.20 | notified **0** / 100 watchers |
| `subscriptions/update-one/fanout` | 2.70 | 4.30 | notified **100** / 100 watchers |
| `async-waterfall/remount/20` | — | 759 | maxInFlight **1** of 20 — **SERIALIZED** |

`async-waterfall` reports no `scriptMs`; the scenario measures wall time and a
concurrency census, not a synchronous flush.

### What the numbers say

**Windowing removes the DOM cost, not the data cost.** At 50k records, `create`
is 798ms full-DOM against 338ms windowed — but the windowed list still pays
338ms, because seeding 50,000 records is a cost both strategies share. The
~460ms difference is what 350,000 elements and 50,001 view instances cost.
`layout` makes this unusually stark: 674ms full-DOM versus **0.45ms** windowed,
flat from 1k to 50k.

**Paint dominates at scale, and it is the browser's cost, not the framework's.**
`keyed-list/create/50000` is 798ms of script inside 2198ms to the painted frame.
Reporting a single number would hide that roughly two-thirds of the wait is the
engine, and that no amount of reconciler tuning would recover it.

**Ops touching only rendered rows are effectively free when windowed.**
`swap-rows` at 50k: 280ms full-DOM, 1.10ms windowed — ~255x. `update-every-10th`:
297ms against 12.6ms.

**`clear` is pure teardown and scales with what is being torn down** — 230ms at
50k full-DOM versus 41.2ms windowed, with layout at ~0.13ms in both. That is
destructor and store work, not rendering.

**Subscription precision holds in production.** One write outside the watched
window wakes 0 of 100 precision watchers and 100 of 100 fan-out watchers. The
0.10ms precision figure is at the measurement floor, not a real value.

**The async `data()` serialization is real in production too.** 20 independent
async `data()` evaluations, nothing shared, nothing queried: `maxInFlight` is 1.
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

- **`inline`** — the default, and what `baseline.json` was recorded from —
  passes data-capturing props: `@select={ selectRow(row) }`. `row` is a loop
  variable, so codegen cannot cache the closure (D62,
  `compileEventValue` in `compiler/internal/codegen/expr.go`) and mints a fresh
  arrow per row per parent render. Those arrows are component **props**, so they
  take part in `patchComponent`'s `shallowEqual(oldProps, newProps)` bailout
  (`client-runtime/views/viewManager.js`) — and a fresh function object never
  compares equal. Every mounted row therefore re-runs `data()` and re-renders on
  every parent render, however little changed.
- **`stable`** passes bare method references: `@select={ selectById }`. Those
  *are* cacheable, so codegen emits `((this.__h ??= {})[N] ??= ...)` — one
  function object per site per view instance, identical across renders. An
  untouched row's props then compare fully equal and `applyParentUpdate()`
  returns without running `data()` and without rendering.

The row capture has to go somewhere, and in `stable` it moves **into the child**:
`ListRow` calls `props.select?.(props.id)` and the parent re-queries by id. That
is the entire difference. `ListRow` is shared with `virtual-list`, which is
unaffected — the inline closure simply ignores the extra id argument.

### Running it

`--filter handlers-` runs only this comparison: 20 entries appended to the end of
`OPS`, with ids `handlers-inline/*` and `handlers-stable/*`. The existing
`keyed-list/*` and `virtual-list/*` ids and params are untouched, and the
`inline` arm deliberately does **not** pass `handlers=inline` — it is the
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
zero mean opposite things here. `childDataRuns` is the exception — it is a plain
integer in `examples/stress/app/row-metrics.js`, incremented at the top of
`ListRow.data()`, so it survives into the shipped bundle and is present in every
build. The table's `handlers` column is reported by the scenario itself, so an
arm cannot be mislabelled. **Never quote a development run's milliseconds.**

### The behaviour gates

A variant that is faster because it quietly stopped working is worthless, so each
arm must prove it still works before any of its numbers are believed.
`click-select` and `click-remove` are **behaviour gates, not measurements**: they
dispatch a real DOM click at the first rendered row and throw unless the
selection actually flipped — in the store *and* in the DOM — and unless that
exact record left both the store and the DOM. They run first within each arm, at
one iteration with no warmup; a throw is reported as `ERROR` and fails the run.
Their milliseconds mean nothing. **Both arms pass.**

### The timings

Production build, 15 recorded iterations, medians, darwin-arm64, headless
Chromium 149.0.7827.55, bundle 103.8 KB — larger than the 99.4 KB quoted above
because the example now carries both arms. MAD ran 1–6%, against the ~13%
detection threshold established under
[Instrument variance](#instrument-variance).

Median in-page `script ms`:

| op | n | `inline` | `stable` |
| --- | ---: | ---: | ---: |
| `create` | 1,000 | 19.7 | 19.1 |
| `update-every-10th` | 1,000 | 4.90 | 2.60 |
| `swap-rows` | 1,000 | 8.90 | 5.10 |
| `select-row` | 1,000 | 4.50 | 1.70 |
| `create` | 10,000 | 164 | 162 |
| `update-every-10th` | 10,000 | 46.7 | 22.2 |
| `swap-rows` | 10,000 | 47.0 | 18.5 |
| `select-row` | 10,000 | 42.3 | 14.3 |

CDP `task ms` at 10,000 rows — the renderer's own accounting, as the independent
second opinion:

| op | `inline` | `stable` |
| --- | ---: | ---: |
| `create` | 439 | 439 |
| `update-every-10th` | 116 | 53.8 |
| `swap-rows` | 135 | 92.3 |
| `select-row` | 78.3 | 21.4 |

**Read the 10,000-row rows.** At 1,000 rows most of the `stable` arm lands under
the 5ms mark below which [Instrument variance](#instrument-variance) says a
delta is not worth trusting; the direction agrees there, the magnitude is not
readable. `create` is unchanged in both arms and at
both sizes — nothing can bail out on first mount, so there is nothing for the
stable spelling to save. Every op that mutates an existing 10,000-row list is cut
by more than half in script time. The renderer's `task` totals agree, though less
sharply on `swap-rows` — the DOM work there is identical in both arms (see below)
and is a larger share of the total.

### The structural counts — the decisive evidence

Development build, n=10,000. These are exact counts, not medians: they are
properties of the render algorithm, not of the machine, so a difference between
the two arms is a real difference.

| op | arm | childDataRuns | renders | wastedRenders | propBailouts | propReruns | domMutations |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `create` | `inline` | 10,000 | 10,001 | 0 | 0 | 0 | 220,004 |
| `create` | `stable` | 10,000 | 10,002 | 0 | 1 | 0 | 220,009 |
| `update-every-10th` | `inline` | 10,000 | 10,001 | 9,001 | 0 | 10,000 | 2,000 |
| `update-every-10th` | `stable` | 1,000 | 1,001 | 1 | 9,000 | 1,000 | 2,000 |
| `swap-rows` | `inline` | 10,000 | 10,001 | 10,000 | 0 | 10,000 | 997 |
| `swap-rows` | `stable` | 0 | 1 | 0 | 10,000 | 0 | 997 |
| `select-row` | `inline` | 10,000 | 10,001 | 10,000 | 0 | 10,000 | 1 |
| `select-row` | `stable` | 1 | 2 | 1 | 9,999 | 1 | 1 |

**The DOM work is identical, and that is the whole point.** `domMutations`
matches exactly on all three mutation ops — 2,000 for `update-every-10th`, 997
for `swap-rows`, 1 for `select-row`. The `stable` arm is not skipping work the
user can see. It patches precisely the same nodes; it just stops waking the rows
that had nothing to do.

On `create` the two arms differ by one render and five mutations out of 220,004.
That is the control panel, not the list: `Home` polls `scenarioStats()` on a 1s
interval and suppresses it only while its OWN buttons are driving an op, so a
harness-driven op can have the poll land inside the measured window and repaint
the four stat readouts. It is not row-proportional, it lands on whichever arm
happens to straddle a tick, and it cannot touch `childDataRuns`, which counts
only `ListRow.data()`. Treat the framework counters as exact to within about one
render for this reason; `childDataRuns` is exact, full stop.

**The bailout works.** `swap-rows` on the `stable` arm is the cleanest read in
the suite: **0** child `data()` runs, **1** render, **10,000** prop bailouts —
and the same 997 DOM mutations as the arm that re-rendered all 10,000 rows.
`select-row` is the same shape with one row genuinely affected: 1 child `data()`
run against 9,999 bailouts. `update-every-10th` writes 1,000 records and runs the
child `data()` exactly 1,000 times.

**The inline idiom defeats it.** The same three ops on the `inline` arm: 10,000
child `data()` runs, ~10,000 wasted renders, 10,000 prop re-runs and **zero**
bailouts, every time, whether the op touched 1,000 rows or one.

So the cascade is not a framework defect. `patchComponent`'s `shallowEqual` prop
bailout is correct and, given stable props, extremely effective; the canonical
Puzzle list idiom — the shape `examples/todos` uses — is what disarms it, by
handing the patcher a brand-new function object per row per render.

It does not overturn the windowing result either: `create`, the op windowing wins
hardest on, is the one op the stable spelling cannot help.

---

## Route churn — what a committed navigation costs a reused ancestor

Two ops, `route-churn/navigate-burst/100` and `route-churn/params-burst/100`.
The full derivation, the per-level table and the mechanism live in
`examples/stress/README.md`; this section covers what belongs to the harness.

**Only the UNPACED arms are in the matrix, and that is a measurement decision
rather than a stylistic one.** `route-churn`'s other ops run at a fixed
navigations-per-second, so their duration is an input; worse, a 100-navigation
op at 5/sec lands on 20,000ms, and guard 4 (whole-second clustering) would
rightly reject it. The paced arms exist because a **development** build's D121
runaway-render detector fires on fast navigation over a deep route tree —
production has no detector, so the burst arms are both safe and honest here.

| op | script ms | paint ms | task | other | live nodes | views |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `navigate-burst/100` | — | **25.2** | 27.3 | 22.0 | 20 | 7 |
| `params-burst/100` | — | **17.1** | 20.2 | 16.7 | 20 | 7 |

Both report no `scriptMs`: a navigation is not a synchronous flush, so the
scenario measures wall time around the whole loop, exactly as `async-waterfall`
does. MAD was 2–3% across 15 iterations.

0.25ms per leaf-divergence navigation against 0.17ms for the params-only
control. **Read that next to the counters, not instead of them:** 27 ancestor
renders inside 0.25ms means each render is ~9µs, because these ancestors render
one span and a `<Slot/>`. The finding is a multiplier on whatever a real app's
layouts do per render.

The asserted counters are the payload, and they are exact rather than
statistical — properties of the router, not of the machine:

| counter | `navigate-burst` | `params-burst` |
| --- | ---: | ---: |
| `rcAncestorRenders` | **2,700** (27/nav) | **2,100** (21/nav) |
| `rcAncestorDataRuns` | 600 (6/nav) | 600 (6/nav) |
| `rcAncestorMutations` | 500 — all at the divergence level | **0** |
| `rcLayoutRenders` | 200 (2/nav) | 100 (1/nav) |
| `rcLeafMounts` | 100 | **0** — the leaf instance is reused |

`rcLeafMounts` is the assertion that keeps the control honest: if the
params-only arm ever remounted its leaf it would not be a params-only arm.

## Listener churn — pricing the invoker pattern

Three arms over identical DOM: `churn`, `stable`, `none`. `rerender` is the
uninstrumented timing arm; `count-listeners` is the same 20 renders with
`Element.prototype`'s `addEventListener`/`removeEventListener` patched **by the
scenario**, so its counts are exact and its milliseconds carry the probe. The
two must never be compared across, the same split `formatters` uses for
`count-intl`.

Production medians of 15, 20 renders per op, uninstrumented arm:

| n | `churn` | `stable` | `none` | churn − stable |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 74.4 | 40.2 | 45.7 | **34.2ms (46.0%)** |
| 10,000 | 651 | 443 | 413 | **208ms (32.0%)** |

`stable` and `none` are within noise of each other; at 1,000 rows `stable` reads
lower than `none`, which is an instrument artefact (MAD 11%) rather than a
result. Only the `churn` gap is readable.

Structural counts over 20 renders of 10,000 rows, and they are the finding:

| arm | `addEventListener` | `removeEventListener` | per render |
| --- | ---: | ---: | ---: |
| `churn` | 400,000 | 400,000 | 40,000 |
| `stable` | **0** | **0** | **0** |
| `none` | **0** | **0** | **0** |

**Zero. The canonical Puzzle handler spelling rebinds nothing**, because
`@click={ onSelect }` compiles to a per-instance cached arrow and never fails
`patchAttrs`'s identity check. The invoker pattern's saving in idiomatic code is
therefore exactly 0%.

`probe-listener-churn.mjs` confirms that on `keyed-list` itself, by patching
`Element.prototype` from the driver so no app change is needed:

| `keyed-list/update-every-10th` | child `data()` runs | add | remove |
| --- | ---: | ---: | ---: |
| n=10,000 `handlers=inline` | 10,000 | **0** | **0** |
| n=10,000 `handlers=stable` | 1,000 | **0** | **0** |

All 10,000 rows re-evaluating and re-rendering, and not one listener rebound.

`micro-listener-cost` prices the parts over the real rendered elements,
batch-timed (per-round timing put the invoker arm under the `performance.now()`
clamp, where it reported a flat 0.0ns — a floor artefact shaped like a result):

| operation | per handler |
| --- | ---: |
| `removeEventListener` + `addEventListener` | ~200ns |
| invoker property write | **~1.5ns** |
| arrow allocation | ~4ns *(likely understated — escape analysis)* |

So of the 208ms `churn` penalty at 10,000 rows, the DOM API is ~80ms — **~12% of
that arm's render time and only ~38% of its own penalty**. The rest is the
remainder of `setAttr`'s per-call work (it re-parses the event name on every
call, walks the `LISTENERS` map, stores the handler) plus the closure allocation.
**An invoker removes none of that** — `setAttr` is still entered whenever the
handler identity changes; only the remove/add pair becomes a property write.

**The answer is that it is not worth adopting.** Not because the effect is
invisible, but because it is absent from the code people actually write, and
because the shape that does pay is fixed better and more cheaply by spelling the
handler cacheably — that recovers the whole 32% against the invoker's ~12%, with
no framework change and no regression risk.

`rerender` runs **20** renders, not 30. At 30 the churn arm landed at ~1,095ms
and guard 4 rejected the sample set — 8 of 8 samples within 60ms of a whole
second is indistinguishable from a throttled renderer. 20 puts it at ~650ms.
This is the second time that guard has moved an op's parameters rather than its
verdict; `async-waterfall`'s delay=35 was the first. `count-listeners` carries a
3-iteration `CAP` (its counts are algorithmic, not statistical).

---

## Production versus development

Same harness, same machine, same headless Chromium, 15 iterations,
`--build-mode development` against the production baseline. The dev bundle is
319.2 KB with `__PUZZLE_DEVTOOLS_HOOK__` present; the production one is 99.4 KB
with it absent.

| op | mounted views | dev script | prod script | Δ abs | Δ % |
| --- | ---: | ---: | ---: | ---: | ---: |
| `keyed-list/create/1000` | 1,001 | 23.5 | 19.3 | +4.2ms | +21.8% |
| `keyed-list/create/10000` | 10,001 | 203 | 171 | +32ms | +18.7% |
| `keyed-list/create/50000` | 50,001 | 988 | 798 | **+190ms** | +23.9% |
| `virtual-list/create/1000` | 26 | 10.3 | 8.50 | +1.8ms | +21.2% |
| `virtual-list/create/10000` | 26 | 69.5 | 68.3 | +1.2ms | +1.8% |
| `virtual-list/create/50000` | 26 | 341 | 338 | +3.0ms | +0.8% |

**Read the absolute column, not the percentage.** The dev build's cost tracks
**mounted view count**, and the per-view figure is strikingly stable across two
orders of magnitude: 4.2ms/1,001 views, 32ms/10,001, 190ms/50,001 — about
**3–4 microseconds of dev overhead per mounted view**. That is consistent with
per-view dev registration and the devstate live-view registry.

`virtual-list` mounts 26 views at every size, so its dev overhead is a flat
1–3ms regardless of `n`. As a percentage that reads as +21% at 1k and +0.8% at
50k, which looks like an inconsistency and is not one — it is a constant
absolute cost divided by growing work.

The consequence is what matters. Dev-build numbers do not merely run slow: the
penalty lands almost entirely on the strategy that mounts many views, so a
dev-build A/B **overstates the case for windowing**. At 50k the dev build adds
190ms to the full-DOM create and 3ms to the windowed one.

Structural counters were identical across both builds, as they must be.

---

## Instrument variance

Non-negotiable for a benchmark: run it twice on an unchanged tree and see
whether it can tell itself apart from the framework.

This was done twice: two full suites on the current tree (the pair the committed
`baseline.json` comes from), and an earlier pair on the same source. 28 ops each,
55 comparable medians per pair.

**Current pair** (run 2 against the committed baseline):

| sample group | median abs. delta | p90 | max |
| --- | ---: | ---: | ---: |
| all comparable medians | 1.1% | 8.8% | 100.0% |
| ops with script median >= 5ms | **1.4%** | **8.8%** | **12.9%** |
| ops with script median < 5ms | 0.0% | 16.7% | 100.0% |

**Earlier pair**, for corroboration: all ops median 2.4%; ops >= 5ms median
2.1%, max 10.1%.

**Detection threshold: on ops above 5ms, treat anything under ~13% as noise.
Sub-5ms ops cannot be compared at all.** The 100% outlier is
`subscriptions/update-one/precision` moving from 0.10ms to 0.00ms — one
`performance.now()` tick wearing a percentage costume. The table prints `flr`
instead of a percentage whenever either side is at the floor, and the LOG
section adds a `FLOOR` line, so these cannot be misread as findings.

The harness is therefore *not* measuring itself in the range that matters: above
5ms, run-to-run disagreement has a median of 1.4% and a worst case of 12.9%,
while the effects it exists to show are 3x to 255x. It has no resolution below
~5ms and says so rather than pretending otherwise.

One honest caveat: the largest drifts are not scattered randomly. In the earlier
pair they clustered on the four `clear` ops, all in the same direction (+7.7% to
+10.1%); in the current pair the worst offenders are the 1,000-row ops. Small and
teardown-heavy ops look systematically drift-prone — allocator or thermal state
rather than random noise — so deltas under ~13% on those rows deserve extra
suspicion.

All four suite runs: 28/28 ops `ok`, zero validate failures, zero structural
mismatches, zero clamp rejections, exit 0. Wall time ~7 minutes per suite.

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
- **The newest op groups have no committed baseline.** `route-churn/*`,
  `listener-churn/*`, `flip-churn/*` and `virtual-list/native-scroll` were added
  after `baseline.json` was last written, so their `Δscript`/`Δpaint` columns
  read `—` and `compareCounters` has nothing to compare against. Their `expect`
  blocks and invariants still assert every structural counter on every run; only
  the baseline cross-check is missing until someone runs `npm run bench:update`.
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
