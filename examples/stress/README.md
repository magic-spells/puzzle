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
/?scenario=deep-nest&n=64&depth=24
/?scenario=write-storm&n=10000
/?scenario=islands&n=100&descendants=200
/?scenario=formatters&n=10000
/?scenario=loop-trap&cap=500
```

## The control surface

```js
window.__STRESS__ = {
  ready,                  // Promise — resolves once the app has mounted
  scenarios,              // ['keyed-list', 'virtual-list', 'subscriptions', 'async-waterfall',
                          //  'deep-nest', 'write-storm', 'islands', 'formatters', 'loop-trap']
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
`update-every-10th`, `select-row`, `swap-rows`, `remove-row`, `click-select`,
`click-remove`, `append-1k`, `clear`.

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

### `?handlers=inline|stable`

`keyed-list` renders its rows two ways, chosen by a query parameter and by an
in-page **handlers** toggle (`inline` / `stable`, next to the row-count control —
scoped to this scenario, because no other one implements both arms). The default
is `inline`, and everything else about the two arms is identical: same records,
same ops, same `ListRow`.

```
/?scenario=keyed-list&n=10000&handlers=inline
/?scenario=keyed-list&n=10000&handlers=stable
```

- `inline` — `@select={ selectRow(row) }`. `row` is a loop variable, so the
  compiler cannot cache the closure and mints a fresh arrow per row per parent
  render. Callback props take part in `shallowEqual`, a fresh function object
  never compares equal, and every mounted row therefore re-runs `data()` and
  re-renders.
- `stable` — `@select={ selectById }`. A bare method reference *is* cacheable,
  so codegen emits one function object per site per view instance. An untouched
  row's props then compare fully equal and the child bails out without running
  `data()` or rendering at all.

The capture moves into the child: `ListRow` reports `props.id` and the parent
re-queries the record by it. `ListRow` is shared with `virtual-list` and is
unaffected — the inline closure ignores the extra id argument.

Both arms have to behave identically, and two ops enforce that. They are
**behaviour gates, not measurements**: `click-select` dispatches a real DOM click
at the first rendered row and throws unless the selection flipped in the store
*and* in the DOM; `click-remove` clicks that row's remove button and throws
unless that exact record left both. Ignore their timings — an arm that got faster
by quietly not working has to fail, not report a number.

`app/row-metrics.js` counts child `data()` runs (one integer, incremented at the
top of `ListRow.data()`), because the framework's own render counters are
compiled out of production builds. Read it back through
`__STRESS__.stats().childDataRuns`; each op's log line prints it too, alongside
the framework counters when the build has them.

Switching arms remounts the scenario, so call `warmup()` again before comparing
by hand. The measured comparison, and what it proves about `shallowEqual`, is in
`benchmarks/README.md` under "The handler A/B".

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

## Scenario 5 — `deep-nest`

**Probes:** is the cost of one update proportional to DEPTH, or does it traverse
the whole forest?

64 branches × 24 nested levels = **1,536 real `PuzzleView` instances**.
`NestNode.pzl` renders *itself* for the next level down — genuinely nested
components, not simulated depth. The self-reference needs no import: a
capitalized tag compiles to a bare identifier inside the render function, and the
class binding is already in module scope.

Ops: `update-leaf`, `update-branch-root`, `update-global`.

The decisive counter is `nodeDataRuns` — node `data()` executions across the op,
counted by `app/nest-metrics.js` so it survives into a production bundle, exactly
like the handler A/B's `childDataRuns`.

| op | writes | nodes that ran `data()` |
| --- | --- | ---: |
| `update-leaf` | the deepest node of branch 0 | **1 / 1,536** |
| `update-branch-root` | the shallowest node of branch 0 | **1 / 1,536** |
| `update-global` | the record every node also queries | **1,536 / 1,536** |

**Both hypotheses are refuted.** A leaf update is proportional to neither depth
nor forest size — it is O(1). One view re-evaluates and re-renders; its child
receives shallow-equal props and takes the component bailout, so propagation
stops dead at the node that changed. A branch-root update is *also* 1, not 24:
depth costs nothing unless the data being threaded down actually changes.

`update-global` is the **control**, and it is what makes the other two numbers
worth anything. Every node also queries one shared record, so a write to it must
wake all 1,536. A scenario whose subscriptions were quietly broken would report a
very impressive `1` for the leaf write and mean nothing at all.

**What a bad result looks like:** `update-global` reporting less than 1,536
(notifications being dropped, which also fails `validate()` — every node renders
the shared record's version, so the DOM would disagree with itself), or the other
two reporting ~24 (props churning down the chain, which would mean the scenario
was measuring its own prop allocation).

## Scenario 6 — `write-storm`

**Probes:** does the rAF-batched flush hold under mutation pressure, and what
does persistence cost?

10,000 records. Ops: `sustained` (600 writes/sec for 10s), `burst` (5,000
synchronous writes in one tick), and `-persist` variants of each.

Both counters have to survive into a production bundle, so the scenario wraps
`store.flush` and `store._persistNow` on the live instance for the duration of a
run and restores them after. The runtime is not touched.

### Batching holds, unconditionally

| op | writes | flushes |
| --- | ---: | ---: |
| `burst` | 5,000 in one tick | **1** |
| `sustained` | 5,988 over 10.0s | **1,200** |

`burst` is the clean assertion: 5,000 writes, one flush. The op deliberately
never calls `flush()` by hand — letting the frame arrive *is* the test.

`sustained` flushes track **frames, not writes**: 1,200 flushes in 10 seconds is
120/sec, which is this headless renderer's real rAF rate, against 598 writes/sec
going in. Roughly five writes collapse into every flush. Nothing piles up.

### Persistence is the finding

`Store._persistNow()` serializes the **whole store** — every record of every
type, through `toJSON()` — and `JSON.stringify`s it, once per dirty flush. At
10,000 records that is a **2,583 KB** blob costing **~15ms**, and it is paid per
mutating *frame*:

| op | wall | time in persistence | share |
| --- | ---: | ---: | ---: |
| `burst-persist` | one tick + a frame | 15.0ms × 1 serialize | — |
| `sustained-persist` | 10,010ms | **9,552ms** across 770 serializes | **95%** |

Under a sustained write load a 10,000-record store spends **95% of the wall
clock serializing itself**, and the frame rate collapses from 1,200 flushes to
770 for the same number of writes. This is O(store) per mutating frame, not
O(changed records).

**The reported persistence time is a lower bound.** The probe attaches an
in-memory storage shim rather than real `localStorage`: 2.5MB is well past the
~5MB quota once you account for the existing payload, and `_persistNow` swallows
the resulting `QuotaExceededError` — so a "real" run would be timing a write that
*failed*. The shim keeps the O(store) half honest (serialize + stringify, the
part that scales) and makes the storage write itself a constant-time assignment.
The actual `localStorage.setItem` cost is **not** included.

`sustained` and `sustained-persist` are deliberately **not** in
`benchmarks/scenarios.mjs`. They run for a fixed 10 seconds, so their
milliseconds are set by construction rather than measured, and their flush counts
track the host's real frame rate — a counter that legitimately differs between
machines has no business in a committed baseline.

## Scenario 7 — `islands`

**Probes:** does `island` really freeze its subtree, and what does the freeze
still cost?

100 island elements × 200 descendants = **20,000 nodes** the patcher is
contractually forbidden from touching after mount. Op: `shell-churn` re-renders
the surrounding view at frame rate for 5 seconds.

Measured over 600 shell renders:

| measurement | result |
| --- | ---: |
| DOM mutations below an island boundary | **0** |
| shell mutations in the same window (control) | 600 |
| island child vnodes built | 12,000,000 |
| …per render | **20,000 of 20,000** |

**The assertion holds exactly.** Zero — measured with a real `MutationObserver`
over the grid, not by trusting the patcher. Attribute and `characterData` changes
on an island *element* are not violations (island freezes children, not the
element) and are counted separately rather than folded in. The shell has its own
observer as the control: zero island mutations means nothing unless the shell
provably mutated in the same window.

**And the cost is confirmed too.** `island` saves *patching*, not *allocation*.
`viewManager.js`'s island branch runs inside `patch()`, which is only reached
**after** `render()` has already built the entire new tree — so all 20,000 child
vnodes are constructed on every single render and then thrown away
(`newVnode.children = oldVnode.children`). Each descendant's `label` is a getter
that counts its own reads, so this is a measured number rather than an inference
from the source: 20,000 per render, the full frozen count, every time.

**What a bad result looks like:** any non-zero `islandViolations` (the island
contract is broken, and `validate()` fails), or `shellDidMutate` reading 0 —
which would mean the churn never ran and the zero above measured nothing.

No components live inside an island here, and none may: the compiler rejects a
component, `<children/>` or `<slot>` anywhere in an island subtree.

## Scenario 8 — `formatters`

**Probes:** what does the built-in formatter registry cost across a large
re-render, and how much of it is `Intl` construction?

10,000 rows through `{ row.createdAt | date('short') }` and
`{ row.createdAt | timeago }`. Three ops, because one op cannot answer both
questions honestly:

- `rerender` — the formatted arm, **no instrumentation of any kind**.
- `rerender-raw` — the identical tree with identical per-row patch work, but the
  two spans render plain record strings. The **control**.
- `count-intl` — the formatted arm again with `Intl` patched and the registry
  entries wrapped. Its *counts* are exact; its *milliseconds* carry the probe.

Timing a wrapped formatter would add two `performance.now()` calls to each of
20,000 invocations — several milliseconds of pure instrument against the thing
being measured. That is why the share comes from the A/B, not from the wrapper.

### One Intl object per call, confirmed

| constructed during one 10,000-row render | count |
| --- | ---: |
| `Intl.DateTimeFormat` | **10,000** |
| `Intl.RelativeTimeFormat` | **10,000** |

Exactly one per formatter call, for 20,000 calls. `builtins.js` constructs a
fresh `Intl.DateTimeFormat` inside `date()` and a fresh `Intl.RelativeTimeFormat`
inside `timeago()` every time, and both are perfectly cacheable by
`(locale, options)`. Nothing is memoized today.

The `Intl` patch lives in the scenario, on `globalThis.Intl` — the runtime is not
modified. The point is to find out what it currently does, not to change it.

**What a bad result looks like:** the two counts diverging from the call count
(which would mean the scenario is not measuring what it thinks), or
`rerender-raw` costing the same as `rerender` (which would mean the formatted arm
never ran the formatters).

## Scenario 9 — `loop-trap`

**Probes:** the D121 loop detector (`client-runtime/devperf.js`), which had a
unit test and **had never fired in a real browser**.

Two deliberate pathologies, each behind its own explicit button. Ops:
`recursive-loop`, `runaway-rerender`, `stop`.

- **`recursive-loop`** — `data()` queries a record and then *writes* it. The
  query subscribes the view to that record, so the batched flush wakes it, which
  runs `data()` again, which writes again. devperf keeps the whole thing in ONE
  causal chain — the store sits in `chain.pendingStores` across the rAF boundary,
  which is what stops the chain quiescing between frames — so the per-chain
  execution counter climbs one per frame.
- **`runaway-rerender`** — a plain rAF loop calling `refresh()` at frame rate
  while `data()` returns a constant, so every render mutates zero DOM. Each frame
  gets its own causal chain (nothing keeps the previous one alive, so it quiesces
  in a microtask), which is precisely why the per-chain counter can never catch
  this shape and the cross-frame rolling-window guard has to exist.

### Both arms fire, at exactly the documented thresholds

| arm | kind reported | fired at | detector constant |
| --- | --- | ---: | --- |
| `recursive-loop` | `recursive` | **depth 100** | `RECURSION_LIMIT = 100` |
| `runaway-rerender` | `cross-frame` | **60 renders, 97% wasted** | `RUNAWAY_RENDER_LIMIT = 60`, `RUNAWAY_WASTED_RATIO = 0.9` |

In both cases the detector **stopped the loop**: each arm ended at its detection
count, far below the scenario's own hard cap of 500. D121 works as specified in a
real browser.

The verdict is rendered on the page, not just logged. The detector also emits
`perf-warning` over the DevTools bridge, so an attached Performance panel shows
the same event under warnings — it is one detection reported twice, not two
independent ones.

### The rolling window is contaminable, and that is correct

Run back to back, `runaway-rerender` first reported firing at **101** renders
rather than 60. That is not a detector bug: the immediately preceding
`recursive-loop` arm's renders *did* mutate DOM, they were still inside the
1000ms window, and they held the wasted ratio under 90% until enough zero-mutation
renders outvoted them. A guard that blamed a view which had been doing real work
a moment ago would be worse.

`runArm()` therefore waits the window out before arming anything, so the reported
count is a property of the **detector** rather than of whatever the scenario
happened to run a second earlier. This is worth knowing when reading a real
`perf-warning`: the count it names is the window's, and the window remembers the
last second of everything that view did.

### Safety

This scenario exists to build runaway loops, so nothing about stopping them is
left to chance:

- Each pathology has a **hard iteration cap** (default 500, `?cap=`), checked
  *before* the next iteration is scheduled, so the counter can never pass it. In
  a production build — where the detector does not exist at all — this cap is the
  only thing that ends the loop, which is exactly why it is there.
- A **live iteration counter** and a **stop button** are on the page. The counter
  is polled at 10Hz from the host rather than rendered by the looping view,
  because the looping view's output must stay byte-identical for the runaway arm
  to mean anything.
- A 30s **watchdog** on top of both. `validate()` fails if it was ever the thing
  that ended a run.
- **No `window.confirm()` or `alert()` anywhere near this.** A modal blocks the
  event loop, which would freeze the rAF loop being measured and wedge the very
  tab the guard is supposed to protect.

The host makes no store query at all, for the same reason `subscriptions`'s parent
does not: a query would drag the host into the same causal chain and inflate the
counter being measured.

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
  precisely why windowing wins at scale. `?handlers=stable` on `keyed-list`
  makes the cost of that idiom directly measurable.
- **`ListRow` takes primitive props, not the record.** Record props carry
  identity, not liveness: records mutate in place, so passing `row={ record }`
  would hand the patcher the same reference before and after an update,
  `shallowEqual` would report "unchanged", and `update-every-10th` would silently
  fail to repaint.

## Not yet implemented

Four scenarios from the original plan remain **not built**. Nothing in the app
references them; they are listed here as future work, not as shipped features.

| scenario | would probe |
| --- | --- |
| `route-churn` | navigation cost, superseded navigations, back/forward |
| `form-state` | `setData` throughput under a typing burst |
| `virtual-scroll` | the userland windowing recipe as its own scenario (partly superseded by `virtual-list`) |
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
  row-metrics.js            child data() counter that survives a production build
  nest-metrics.js           the same, for deep-nest's node data() runs
  models/                   one record schema, registered per scenario type
  layouts/StressLayout.pzl
  views/Home.pzl            control panel, stats, log, scenario host
  scenarios/
    ListRow.pzl             the shared 7-element row
    KeyedList.pzl           every row mounted
    VirtualList.pzl         windowed, same records and rows
    Subscriptions.pzl + SubRow.pzl
    AsyncWaterfall.pzl + AsyncCell.pzl
    DeepNest.pzl + NestNode.pzl     1,536 genuinely nested views
    WriteStorm.pzl                  batched-flush and persistence pressure
    Islands.pzl                     20,000 frozen nodes, observed
    Formatters.pzl                  the built-in registry priced
    LoopTrap.pzl + LoopCell.pzl     the D121 detector's real exercise
```

Each new scenario owns its own store type (`nest`, `storm`, `fmt`, `loop`) so no
scenario can disturb another's data. `islands` deliberately has none: its 20,000
nodes are plain DOM built from instance state, and giving it a type would imply
the frozen subtree was reactive.

Fixtures are installed directly in `app.js` rather than via `--fixtures`, so
`store.seed()` is available as a tool each scenario calls on demand and
`puzzle build examples/stress` works with no extra flag.
