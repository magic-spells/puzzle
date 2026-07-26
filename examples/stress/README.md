# Puzzle Stress Lab

A deterministic performance harness for the Puzzle runtime. Every scenario is a
real Puzzle app — real routes, real views, real store records, real
reconciliation — driven either by hand from the page or programmatically through
`window.__STRESS__`.

The lab exists to turn hypotheses into measurements. Each scenario is built
around one question that can be answered wrong, and each one validates the DOM
it just rendered before reporting a number, because **a benchmark taken over a
broken render is worse than no benchmark**.

```bash
# from the repo root
go run ./compiler/cmd/puzzle dev examples/stress --port 4180
go run ./compiler/cmd/puzzle build examples/stress --mode development
```

Open <http://localhost:4180/>. Scenario and parameters live in the query string,
so any measurement has a copy-pasteable URL:

```
/?scenario=keyed-list&n=10000
/?scenario=virtual-list&n=50000
/?scenario=subscriptions&mode=fanout&n=100&m=10000
/?scenario=async-waterfall&n=20&delay=50
```

## The control surface

```js
window.__STRESS__ = {
  ready,                  // Promise — resolves once the app has mounted
  scenarios,              // ['keyed-list', 'virtual-list', 'subscriptions', 'async-waterfall']
  definitions,            // [{ name, label, blurb, ops }]
  async select(name, params),
  async reset(),
  async warmup(),
  async run(op),          // resolves ONLY after the DOM has settled
  validate(),             // -> { ok, detail } — inspects the real DOM
  stats(),                // -> { mountedNodes, stageNodes, records, views, scenario }
};
```

`run()` resolving too early is the easiest way to manufacture a garbage number,
so the settle discipline is layered. Each scenario's `run()` calls
`store.flush()` (synchronous notification delivery — every subscribed view
re-evaluates and re-renders inside that call), then awaits `afterPaint()`, which
is `requestAnimationFrame` → `setTimeout(0)`: rAF callbacks run *before* paint,
so the trailing timer is what puts you past the committed frame. `runScenario`
then adds two more frames on top.

Two timings are reported per op:

- **script** — mutation plus reconciliation, measured around the synchronous
  `flush()`. This is the framework's cost with no scheduler slack in it.
- **paint** — the same window extended past the browser's committed frame.

`validate()` is deliberately separate from timing and runs after every action in
the UI. It re-derives the expected state from the store and compares it against
the live DOM: row counts, full row order, spacer geometry, and whatever the last
op specifically claimed to have done.

### `mountedNodes` is the headline

`stats().mountedNodes` is the count of live DOM elements under the **list
container** (not the whole page). For the two list scenarios that single number
is the entire story. `stageNodes` is the whole-scenario count if you want it.

## Scenario 1 — `keyed-list`

**Probes:** the cost of a keyed list where every row is mounted, using the
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) op
set so the numbers are comparable to React/Vue/Svelte.

Ops: `create-1k`, `create-10k`, `create-50k`, `replace-all`,
`update-every-10th`, `select-row`, `swap-rows`, `remove-row`, `append-1k`,
`clear`.

Rows are **real store records** (`store.seed()` from
`@magic-spells/puzzle/fixtures`), not a plain array, so every op goes through
`createRecord` / `record.update()` / `record.destroy()`. The measurement
therefore includes schema validation, the batched notify set, subscription
delivery, `data()` re-evaluation and keyed reconciliation — the framework's real
data path, not just its DOM patcher.

Each row is 7 elements, matching the benchmark's row weight, so
`mountedNodes / 7` is the row count.

**What a bad result looks like:** any `validate()` failure (DOM order diverging
from store order, a swap not reflected, a missing update marker) invalidates the
run entirely. On timing, watch for super-linear growth: 10× the rows costing far
more than 10× the time means something is O(n²) — `create-10k` at 181.8ms
against `create-1k` at 11.0ms is ~1.65× worse than linear, which is the
reconciler and the per-render sort, not a blowup.

**This scenario must never be virtualized.** Its whole job is to show what
holding `n × 7` elements live actually costs. A windowed version would measure
nothing and would make the `virtual-list` comparison vacuous.

## Scenario 2 — `virtual-list`

**Probes:** the same records and the same rows, but only a window is mounted —
a direct A/B against `keyed-list`.

Ops: `create-1k`, `create-10k`, `create-50k`, `update-every-10th`, `select-row`,
`swap-rows`, `append-1k`, `fast-scroll`, `clear`.

The comparison is apples-to-apples by construction:

- **Same records** — both scenarios drive the `row` type through the shared
  `RowOps` (`app/row-ops.js`) off the same fixture seed.
- **Same row markup** — both render `scenarios/ListRow.pzl`. If the windowed
  list rendered cheaper rows, the comparison would measure the markup rather
  than the strategy.
- **Same ops** — the mutation set lives in one place so neither scenario can
  drift into doing less work than the other.

Windowing follows `examples/virtual-scroll`: fixed 36px rows, a computed visible
slice, spacer divs above and below carrying the off-window geometry, and a
`@scroll` handler that only re-renders when the start bucket actually changes.
One deliberate difference from that example: it slices a plain array held on an
instance field, whereas this **queries real store records every render**.

`fast-scroll` drags the window across the whole list in 10 jumps. It writes
`scrollTop` for real (driving the native scrollbar and firing a real scroll
event) and also invokes the window recompute directly, so the op is
deterministic rather than dependent on frame timing.

**What a bad result looks like:** `mountedNodes` growing with `n` at all — the
window is capped at 25 rows, so anything above ~180 elements means windowing
broke. Also a spacer-geometry failure: `topPx + rendered + bottomPx` must equal
`total × 36px` exactly, or the scrollbar is lying about how much list there is.

### The measured comparison

Chrome, development build, one machine, single runs after `warmup()`. These are
**orders of magnitude, not precision benchmarks** — the harness exists to
produce better ones.

Creating the list (script ms / live DOM elements):

| records | `keyed-list` | `virtual-list` |
| ------: | -----------: | -------------: |
|   1,000 | 11.0ms / **7,000** | 8.1ms / **177** |
|  10,000 | 181.8ms / **70,000** | 78.2ms / **177** |
|  50,000 | 1,211.3ms / **350,000** | 337.7ms / **177** |

Time to painted frame for the same creates:

| records | `keyed-list` | `virtual-list` |
| ------: | -----------: | -------------: |
|  10,000 | 1,073ms | 82ms |
|  50,000 | **6,692ms** | 339ms |

Mutating an existing 50,000-record list (script ms):

| op | `keyed-list` | `virtual-list` |
| --- | ---: | ---: |
| `update-every-10th` | 332.9ms | 14.5ms |
| `swap-rows`         | 61.6ms *(at 10k)* | 1.2ms |
| `select-row`        | 41.2ms *(at 10k)* | 0.9ms |
| `fast-scroll`       | n/a | 165.4ms (10 jumps, 9 window re-renders) |

Mounted `PuzzleView` instances at 50,000 records: **50,001** vs **26**.

### What stays bounded and what does not

**Bounded by windowing:** live DOM elements (177, flat from 1k to 50k), mounted
view instances (26), and every op that touches only rendered rows — `swap-rows`
and `select-row` stay near 1ms at 50k because only the visible window
reconciles.

**Not bounded:** the store work. `data()` calls `findMany` and sorts the full
collection on every render, so a windowed list over a reactive store is O(1) in
nodes but **O(n log n) in `data()` per scroll bucket**. That is why `fast-scroll`
costs 165ms for 10 jumps at 50k (~17ms per jump) rather than being free, and why
`create-50k` still costs 337ms on the virtual list — seeding 50,000 records is a
cost both strategies pay. Subtracting it, the ~874ms difference on `create-50k`
is what the DOM and the 50,000 view instances cost.

That decomposition is the useful takeaway: **windowing removes the DOM cost, not
the data cost.** If a windowed list is still slow, the collection query is the
next thing to fix (an index, a cached sort, or a narrower query), not the
rendering.

### The 50k safety guard

At 50,000 rows the real-DOM list is 350,000 elements and takes ~6.7s to paint.
That is a legitimate finding, but it must never happen by accident:

- `keyed-list` **does not auto-seed** above 20,000 rows. It mounts empty and
  says why.
- A warning appears next to the row-count control above that threshold.
- Every action (ops, `reset`, `warmup`) needs a **confirming second click** —
  the button relabels itself to `really run 50000?`. This is in-page state, not
  `window.confirm()`: a modal dialog blocks the event loop and would freeze the
  very thing being measured.
- `validate` is read-only and never gated.
- `virtual-list` has no guard at any size, because windowing is precisely what
  makes 50k cheap.

The programmatic `__STRESS__.run()` deliberately bypasses the arm — a benchmark
driver has already opted in.

## Scenario 3 — `subscriptions`

**Probes:** how much of the app wakes up when exactly one record changes.

`N` mounted views each watch a distinct record out of `M`. Two modes, differing
by a single line inside the child's `data()`:

- `precision` — `store.findOne(type, id)`, subscribing to the key `sub|<id>`
- `fanout` — `store.findMany(type)`, subscribing to the key `sub`

The op writes to a record **outside** the watched window, then counts how many
views re-evaluated. Defaults `n=100`, `m=10000`; both overridable.

Measured with real mounted views:

| mode | views re-evaluated | script |
| --- | ---: | ---: |
| `precision` | **0 / 100** | 0.0ms |
| `fanout`    | **100 / 100** | 4.0ms |

This reproduces the store-level finding end-to-end. The parent's own `data()`
makes **no store query at all** — that is load-bearing. If the parent subscribed
to the collection, one write would re-render the parent, which would re-render
all `N` children, and both modes would read 100/100 for reasons that have nothing
to do with subscription precision.

**What a bad result looks like:** `precision` reporting anything above 0, which
means per-record subscriptions are leaking into collection-level notification;
or `fanout` reporting below `N`, which means notifications are being dropped.
Either makes `validate()` fail.

## Scenario 4 — `async-waterfall`

**Probes:** do `N` independent `async data()` evaluations overlap, or queue?

`N` components (default 100) each `await` ~50ms in their own `data()`. Nothing is
shared, nothing is queried — a naive reading says they should all finish in
roughly one delay.

They do not. Measured through the real router with real mounted views:

```
20 independent async data() × 50ms
  → SERIALIZED: max 1 of 20 evaluating concurrently,
    last cell started +975.1ms after the first · 1027.9ms wall
    (parallel ≈ 50ms, serial ≈ 1000ms)
```

That 1027.9ms matches the previously measured store-level figure (20 evals ×
50ms → 1021ms) almost exactly, confirming the behaviour end-to-end rather than
in isolation.

**The cause** is in `Store.withTracking`: the store keeps a single
`_asyncTrackingChain`, and a known-async evaluation is deferred behind whatever
async evaluation is already in flight — one global chain, store-wide. The
trigger is the *shape* of `data()` (an `AsyncFunction`), not whether it queries
the store, so a component that awaits and touches no record still takes its turn
in the queue.

**The verdict comes from a concurrency census, not the clock.** Each cell
increments an in-flight counter on entry and decrements it after its await;
`maxInFlight` is 1 when they queue and `N` when they overlap. This matters
because wall time alone cannot distinguish "serialized" from "slow" — see the
throttling note below. The census was itself validated against a control of 8
genuinely parallel promises using identical probe logic, which reports 8.

**What a bad result looks like:** `PARTIAL` (max concurrency strictly between 1
and `N`) would mean the chain is being entered inconsistently. `validate()`'s
`ok` deliberately reflects only *render correctness*, not the verdict — a
`SERIALIZED` result is a valid measurement of real behaviour, not a broken
render.

The scenario mounts **disarmed**; press `remount` to mount the cells and time
them. Auto-arming would make simply selecting the scenario cost `n × delay`.

## Measurement caveats

- **Background tabs are throttled.** Chrome clamps `setTimeout` to ~1000ms in a
  hidden tab, which inflates every wall-clock number and would make a genuinely
  parallel implementation read as `SERIALIZED`. Verify with
  `document.hidden === false` and a `sleep(50)` sanity check before trusting
  timings. All figures in this README were taken with the tab visible and
  `sleep(50)` measuring 51ms.
- **Single runs, one machine, development build.** Treat the tables as orders of
  magnitude. Call `warmup()` before comparing.
- **The `keyed-list` sort.** Rows carry an explicit `seq` because `findMany`
  returns Map-insertion order, which cannot be permuted in place. That makes
  `swap-rows` two genuine reactive writes at the cost of one O(n log n) sort per
  render. The sort is inside both the measured op and the baseline render, so it
  does not distort comparisons between ops.
- **Rows are components, and their callback props are data-capturing.**
  `@select={ selectRow(row) }` compiles to a fresh arrow per parent render, so it
  always differs under `shallowEqual` and every parent re-render re-evaluates
  every mounted row. That is the canonical Puzzle list idiom (the same shape
  `examples/todos` uses), both list scenarios pay it identically, and it is
  precisely why windowing wins at scale.
- **`ListRow` takes primitive props, not the record.** Record props carry
  identity, not liveness: records mutate in place, so passing `row={ record }`
  would hand the patcher the same reference before and after an update,
  `shallowEqual` would report "unchanged", and `update-every-10th` would silently
  fail to repaint.

## Not yet implemented

Nine scenarios from the original plan are **not built**. Nothing in the app
references them; they are listed here as future work, not as shipped features.

| scenario | would probe |
| --- | --- |
| `deep-nest` | update cost at depth — leaf vs branch-root vs global |
| `write-storm` | sustained and bursty write throughput against the batched flush |
| `route-churn` | navigation cost, superseded navigations, back/forward |
| `form-state` | `setData` throughput under a typing burst |
| `islands` | `island` children staying frozen while the shell churns |
| `virtual-scroll` | the userland windowing recipe as its own scenario (partly superseded by `virtual-list`) |
| `formatters` | formatter registry overhead across a large re-render |
| `loop-trap` | `data()`-writes-store feedback loops and identical-rerender detection |
| `morph-flip` | morph transitions and `flip` reordering under load |

`route-churn` in particular had scaffolding in an earlier draft — a five-level
nested route tree with 50 generated leaf routes — which imported six `.pzl` files
that were never written. That route subtree was **deleted** from `routes.js`;
the app now has exactly one route and scenario selection rides on the query
string.

## Layout

```
app/
  app.js                    installFixtures + PuzzleApp + __STRESS__ wiring
  routes.js                 one route; scenarios select via ?scenario=
  stress-controller.js      the __STRESS__ control surface + scenario registry
  scenario-utils.js         settle helpers, seeding shapes, param parsing
  row-ops.js                the row mutation set shared by both list scenarios
  models/                   one record schema, registered as `row` and `sub`
  layouts/StressLayout.pzl
  views/Home.pzl            control panel, stats, log, scenario host
  scenarios/
    ListRow.pzl             the shared 7-element row
    KeyedList.pzl           every row mounted
    VirtualList.pzl         windowed, same records and rows
    Subscriptions.pzl + SubRow.pzl
    AsyncWaterfall.pzl + AsyncCell.pzl
```

Fixtures are installed directly in `app.js` rather than via `--fixtures`, so
`store.seed()` is available as a tool each scenario calls on demand and
`puzzle build examples/stress` works with no extra flag.
