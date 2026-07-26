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
| `report.mjs` | medians, MAD, clamp detection, baseline delta, table rendering |
| `baseline.json` | committed reference numbers. Structural counters are asserted against it; timings are informational. |

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

### Flags

```
--filter <substr>     run only ops whose id contains <substr>
--iterations <n>      override the recorded iteration count
--no-build            reuse the staged bundle
--headed              run a visible browser
--build-mode <mode>   production (default) | development — see below
--list                print every op id
```

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
op that threw or timed out, or a rejected (throttle-clamped) sample set.

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
- **Not every stress op is covered.** `replace-all`, `select-row`, `append-1k`
  and `remove-row` exist in the app and are not in the matrix; the nine
  unimplemented scenarios in `examples/stress/README.md` obviously are not
  either. Add entries to `scenarios.mjs` — nothing else needs to change.
- **`subscriptions` precision timing is unmeasurable**, not zero. It sits under
  the `performance.now()` ~100us clamp.

## Adding an op

Append an entry to `OPS` in `scenarios.mjs`, run `npm run bench --
--filter <your-id>` to check it, then `npm run bench:update` to record it. Keep
`prepare` doing the real work of restoring the precondition, and give it an
`expect` or `invariant` — an op with no structural assertion contributes a
number nobody can falsify.
