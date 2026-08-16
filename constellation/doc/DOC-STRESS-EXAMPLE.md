---
name: Puzzle Stress Lab (examples/stress) — the performance measurement app
kind: reference-app
status: verified
connections:
  - DECISION-D128-BENCHMARK-METHODOLOGY
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - COMPONENT-FORMATTERS
  - FLOW-REACTIVITY
  - FILE-DEVPERF
verified_at: '2026-08-16T04:35:12.750Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# Puzzle Stress Lab (examples/stress)

The app the framework is measured *with*. Thirteen scenarios, each a real Puzzle
app — real routes, real views, real store records, real reconciliation — built
around **one question that can be answered wrong**, and each validating the DOM
it just rendered before reporting anything, because a benchmark taken over a
broken render is worse than no benchmark.

Scenario and parameters ride the query string (`/?scenario=keyed-list&n=10000`),
so every measurement has a copy-pasteable URL. The full scenario walkthrough,
op lists and hand-run tables are in `examples/stress/README.md`; the production
harness that drives this app is [[DECISION-D128-BENCHMARK-METHODOLOGY]] and
`benchmarks/README.md`. This card holds intent and the durable gotchas.

## The `window.__STRESS__` contract

The app exposes one control surface, and the benchmark runner is written
entirely against it:

```js
window.__STRESS__ = {
  ready,                  // Promise — resolves once the app has mounted
  scenarios,              // string[] — the thirteen names below
  definitions,            // [{ name, label, blurb, ops }]
  async select(name, params),
  async reset(), async warmup(),
  async run(op),          // resolves ONLY after the DOM has settled
  validate(),             // -> { ok, detail } — inspects the REAL DOM
  stats(),                // -> { mountedNodes, stageNodes, records, views, scenario, … }
};
```

Three properties of that contract are load-bearing:

- **`run()` resolving early is the easiest way to manufacture a garbage number**,
  so the settle discipline is layered: `store.flush()` (synchronous notification
  delivery) → `afterPaint()`, which is `requestAnimationFrame` → `setTimeout(0)`
  because rAF callbacks run *before* paint and only the trailing timer puts you
  past the committed frame → two more frames added by `runScenario`.
- **`validate()` is separate from timing and re-derives expectations from the
  store**, comparing against the live DOM — row counts, full row order, spacer
  geometry, and whatever the last op specifically claimed to have done. It is
  read-only and never gated.
- **`stats().mountedNodes` counts elements under the list container**, not the
  page. For the two list scenarios that single number is the whole story;
  `stageNodes` is the whole-scenario count.

`__STRESS__.run()` deliberately bypasses the 50k confirmation arm — a benchmark
driver has already opted in.

## The thirteen built scenarios and what each probes

| scenario | the question | the answer |
| --- | --- | --- |
| `keyed-list` | what does a fully-mounted keyed list cost, on the js-framework-benchmark op set? | 7 elements/row, 350k live elements and 50,001 views at 50k records |
| `virtual-list` | same records, same row component, windowed — the direct A/B | 177 elements and 26 views, flat from 1k to 50k |
| `subscriptions` | how much of the app wakes when exactly one record changes? | `precision` (`findOne`) 0/100; `fanout` (`findMany`) 100/100 |
| `async-waterfall` | do N independent `async data()` evaluations overlap or queue? | **serialized**, `maxInFlight` 1 of 20 |
| `deep-nest` | is one update proportional to DEPTH, or to the forest? | **neither** — O(1); see "refuted" below |
| `write-storm` | does the rAF-batched flush hold under mutation pressure, and what does persistence cost? | batching holds unconditionally; persistence is the finding |
| `islands` | does `island` really freeze its subtree, and what does the freeze still cost? | 0 violations; 20,000 child vnodes rebuilt per render |
| `formatters` | what does the built-in registry cost across a large re-render? | was 91.4% — priced the Intl cache that cut it to ~23%; `count-intl` now pins 0 constructions |
| `listener-churn` | what does removing and re-adding a DOM listener on every render actually cost? | `churn` costs 46% more than `stable` at 1k rows and 32% at 10k; `stable` and `none` are within noise of each other |
| `route-churn` | how many times does a REUSED route ancestor render per committed navigation? | `depth + 2` — 27 ancestor renders per navigation against 6 `data()` runs, 81.5% mutating nothing |
| `form-state` | what does a keystroke cost the rest of a 400-control form? | both controlled form properties write only on a real change (0 writes on a clean re-render); one `record.update()` rebuilds the schema descriptor map three times |
| `flip-churn` | what do N rows cost the D85 FLIP path at once? | flip is **98.8%** of a 500-row reorder — 68.5ms against 0.80ms for the identical rotation with no `flip` attribute |
| `loop-trap` | does the D121 loop detector actually fire in a browser? | both arms, at exactly the documented thresholds |

`loop-trap` is **not** in the benchmark op matrix at all: the harness measures a
production bundle, where [[FILE-DEVPERF]] does not exist, so there would be no
detector to detect anything. It is exercised through `benchmarks/probe.mjs`
instead ([[DECISION-D128-BENCHMARK-METHODOLOGY]]), which also runs the two
scenario-specific probe scripts `probe-route-churn.mjs` and
`probe-listener-churn.mjs` for the counters their matrix rows cannot express.

## `keyed-list` is deliberately NOT virtualized

Its entire job is to show what holding `n × 7` elements live actually costs.
Windowing it would reconcile ~25 rows regardless of data size — it would measure
nothing, and it would make the `virtual-list` comparison vacuous. Anyone
"optimizing" this scenario has deleted the experiment.

The comparison between the two is apples-to-apples by construction: same records
through the shared `RowOps`, same `ListRow.pzl` markup, same mutation set in one
place so neither can drift into doing less work. What that comparison shows is
that **windowing removes the DOM cost, not the data cost** — `data()` still runs
`findMany` and sorts the full collection every render, so a windowed list over a
reactive store is O(1) in nodes but O(n log n) in `data()` per scroll bucket.

## Findings this app produced

Recorded here as measurements only; each is reachable from the card it concerns.

- **Formatters are 91.4% of a 10,000-row re-render** — 376.1ms formatted against
  32.4ms for an identical tree rendering plain strings, with identical layout
  cost in both arms. 10,000 `Intl.DateTimeFormat` plus 10,000
  `Intl.RelativeTimeFormat` constructed per render, nothing cached
  ([[COMPONENT-FORMATTERS]]).
- **`_persistNow` serializes the whole store per dirty flush** — one 10k
  serialize adds **34.8ms** to a painted frame against **11.5ms** for the 5,000
  writes that triggered it ([[COMPONENT-STORE]]). Persistence is opt-in.
- **Async `data()` is fully serialized** — `maxInFlight` 1 of 20 in production,
  from a concurrency census rather than the clock ([[COMPONENT-STORE]],
  [[FLOW-REACTIVITY]]).
- **A reused route ancestor at depth `d` renders `d + 2` times per committed
  navigation**, so the reused prefix costs **O(depth²)** renders rather than two
  per level. Over five ancestor levels that is 27 renders against 6 `data()`
  runs, 81.5% of them mutating nothing
  ([[DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL]]).
- **Rebinding a DOM listener every render is a real cost** — the `churn` arm
  runs 46% over `stable` at 1,000 rows and 32% over it at 10,000, which is the
  price an invoker pattern would recover ([[COMPONENT-VIEW-MANAGER]],
  [[DECISION-D62-HANDLER-CACHING]]).
- **Caret safety is emergent, not mechanical** — nothing in `client-runtime/`
  touches `selectionStart` or `document.activeElement`; `patchAttrs` compares
  against the live DOM first, so a re-render mid-keystroke writes no `value` and
  never disturbs the caret ([[COMPONENT-VIEW-MANAGER]]).
- **FLIP is 98.8% of a reorder** — 500 rows through `playFlip()` cost 68.5ms
  against 0.80ms for the identical rotation with no `flip` attribute, and the
  cost is forced layout and style rather than framework JavaScript.
- **`island` freezes patching, not allocation** — 20,000 child vnodes rebuilt
  and discarded per render, measured by read-counting getters rather than
  inferred ([[DECISION-D44-DOM-ISLANDS]], [[COMPONENT-VIEW-MANAGER]]).

### Two hypotheses refuted — do not re-fund these

- **Deep nesting is not a cost.** A leaf update runs `data()` on **1 of 1,536**
  views; so does a branch-root update (not 24). Depth costs nothing unless the
  data threaded down actually changes. `update-global` is the control that makes
  those numbers mean anything — it wakes all 1,536, so a scenario with broken
  subscriptions would report a very impressive `1` and mean nothing.
- **The per-row re-render cascade is not a framework bug.**
  `patchComponent`'s `shallowEqual` bailout is correct and extremely effective;
  the canonical Puzzle list idiom disarms it by handing the patcher a fresh
  function object per row per render. [[DECISION-D62-HANDLER-CACHING]] predicted
  exactly this; the `?handlers=inline|stable` A/B measured it.

## Durable gotchas

- **Counters that must survive production live in the app, not the framework.**
  `app/row-metrics.js` (`childDataRuns`), `app/nest-metrics.js`
  (`nodeDataRuns`) and `app/rc-metrics.js` (the per-level route counters) are
  plain integers incremented at the top of the child's `data()`, because
  [[FILE-DEVPERF]]'s counters are compiled out of a production bundle.
  `write-storm` and `islands` do the equivalent by wrapping
  `store.flush` / `store._persistNow` on the **live instance** for the duration
  of a run and restoring after. The runtime is never modified.
- **`route-churn` is the one scenario not hosted in Home's stage.** It measures
  the router, so it needs real route nodes: it is a sibling subtree at `/rc/…`
  with its own layout (`app/rc-routes.js`), and selecting it navigates out of
  `/` so Home unmounts. A second `PuzzleApp` was rejected because
  `devtools.js` holds exactly one app slot and would rebind then tear down the
  bridge; nesting under `/` was rejected because it would make heavyweight Home
  a measured ancestor.
- **A scenario's host must make no store query.** `subscriptions`' parent and
  `loop-trap`'s host both deliberately query nothing: a parent subscribed to the
  collection would re-render on the write and re-render all N children, and both
  subscription modes would read N/N for reasons having nothing to do with
  subscription precision. In `loop-trap` a query would drag the host into the
  same causal chain and inflate the counter being measured.
- **`ListRow` takes primitive props, never the record.** Records mutate in
  place, so `row={ record }` hands the patcher the same reference before and
  after an update, `shallowEqual` reports "unchanged", and `update-every-10th`
  silently fails to repaint. This is [[FLOW-REACTIVITY]]'s record-as-prop caveat
  as a working example.
- **Rows carry an explicit `seq`** because `findMany` returns Map-insertion
  order, which cannot be permuted in place. `swap-rows` is therefore two genuine
  reactive writes at the cost of one O(n log n) sort per render — inside both
  the measured op and the baseline render, so it does not distort comparisons.
- **`form-state`'s grid binds `String(...)`, not the bare member path**, and its
  `draftText` key is one `data()` deliberately never returns — if it did,
  `#recompose()`'s `{ ...#local, ...#model }` would overlay the model value on
  the local one and the first store flush would erase the draft mid-typing.
  Every op installs both probe sets so the two typing arms carry identical
  instrument load, which is also why none of that scenario's timings are clean:
  the finding there is counts-only.
- **No `window.confirm()` or `alert()` anywhere.** The 50k safety arm (a
  confirming second click that relabels the button) and `loop-trap`'s stop
  control are in-page state on purpose: a modal blocks the event loop, which
  would freeze the very thing being measured and wedge the tab the guard exists
  to protect. `keyed-list` also does not auto-seed above 20,000 rows;
  `virtual-list` has no guard at any size.
- **Each scenario owns its own store type** (`nest`, `storm`, `fmt`, `loop`) so
  none can disturb another's data. `islands` deliberately has none — its 20,000
  nodes are plain DOM built from instance state, and giving it a type would imply
  the frozen subtree was reactive. No components may live inside an island; the
  compiler rejects them (D44).
- **Fixtures are installed directly in `app.js`, not via `--fixtures`** (D98), so
  `store.seed()` is a tool each scenario calls on demand and
  `puzzle build examples/stress` works with no extra flag.
- **`deep-nest`'s self-reference needs no import.** `NestNode.pzl` renders
  itself; a capitalized tag compiles to a bare identifier inside the render
  function and the class binding is already in module scope.
- **`loop-trap`'s rolling window is contaminable, and that is correct.** Run
  straight after the recursive arm, the runaway arm first reported firing at 101
  renders rather than 60 — the preceding arm's renders *did* mutate DOM and were
  still inside the 1000ms window. `runArm()` now waits the window out before
  arming. Worth knowing when reading a real `perf-warning`: the count it names is
  the window's, and the window remembers the last second of everything that view
  did.
- **A dev-build `route-churn` run must stay PACED.** Its unpaced arms trip the
  D121 cross-frame detector, and while the detector no longer suppresses
  renders, its own bookkeeping distorts the very render counts being measured —
  which is why the production build is the primary run for that scenario and
  the development one is only an independent cross-check.
- **The persistence figure is a lower bound.** The probe attaches an in-memory
  storage shim, because 2.5MB is past the localStorage quota and `_persistNow`
  swallows the resulting `QuotaExceededError` — a "real" run would be timing a
  write that *failed*. Serialize + stringify (the part that scales) is honest;
  the actual `setItem` cost is not included.
- **Fixed-duration ops are not measurements.** `write-storm`'s `sustained` pair
  and `islands`' `shell-churn` set their own milliseconds by construction and
  their flush counts track the host's real frame rate, so they are deliberately
  absent from the committed baseline. Bounded-by-render-count arms exist for the
  same code paths.

## Not built

One scenario from the original plan remains **future work**, referenced nowhere
in the app: `virtual-scroll` (the userland windowing recipe as its own scenario,
largely superseded by `virtual-list`).

Separately, several ops exist in the app but not in the benchmark matrix
(`replace-all`, `append-1k`, `remove-row`, and `select-row` outside the handler
A/B arms). Adding them is an entry in `scenarios.mjs` and nothing else.
