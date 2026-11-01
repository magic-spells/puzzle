---
name: Puzzle Stress Lab (examples/stress) — the performance measurement app
kind: reference-app
status: built
connections:
  - DECISION-D128-BENCHMARK-METHODOLOGY
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DOC-ARCHITECTURE
  - FLOW-REACTIVITY
  - FILE-DEVPERF
---

# Puzzle Stress Lab (examples/stress)

The app the framework is measured with. Thirteen scenarios, each a real Puzzle app (routes, views, store records, reconciliation) built around **one question that can be answered wrong**, and each validating the DOM it rendered before reporting — a benchmark over a broken render is worse than none. Scenario and parameters ride the query string (`/?scenario=keyed-list&n=10000`), so every measurement has a copy-pasteable URL. Op lists: `examples/stress/README.md`. The production harness: `benchmarks/README.md` and [[DECISION-D128-BENCHMARK-METHODOLOGY]].

## Running it

```bash
# from packages/puzzle
go run ./compiler/cmd/puzzle dev examples/stress --port 4180   # by hand
npm run bench                     # production bundle, compare against baseline.json
npm run bench -- --filter <id>    # one op; --list prints every id
npm run bench:update              # full run, then rewrite baseline.json
node benchmarks/probe.mjs --script <file.mjs>   # dev build, framework counters
```

- `bench` copies the example into `benchmarks/.build/stress-src`, builds it in production mode, serves it statically and drives it with Playwright through `window.__STRESS__`. It never touches `examples/stress/dist`.
- **Gates:** structural counters are asserted exactly (`preExpect`, `expect`, per-scenario `invariant`, and `baseline.json`); timings never are. The run fails only on a `validate()` failure, a counter mismatch, a thrown or timed-out op, a throttle-clamped sample set, or an uncaught page error (`console.error` does not count — recovery paths log on purpose). A failing run refuses to write the baseline, and `--update-baseline` is refused with `--filter` or `--build-mode development`.
- **`probe.mjs`** builds in development mode, where [[FILE-DEVPERF]]'s counters and the D121 loop detector exist, and refuses a bundle without the `__PUZZLE_PERF__` sentinel. Never quote its milliseconds. It runs `loop-trap` and the counter scripts `probe-route-churn.mjs` and `probe-listener-churn.mjs`.
- **Adding an op:** append to `OPS` in `benchmarks/scenarios.mjs`, check it with `--filter`, record it with `bench:update`. Give it an `expect` or `invariant` — an op with no structural assertion is a number nobody can falsify.

## The `window.__STRESS__` contract

```js
window.__STRESS__ = {
  ready, scenarios, definitions,     // Promise; string[]; [{ name, label, blurb, ops }]
  async select(name, params), async reset(), async warmup(),
  async run(op),   // resolves ONLY after the DOM has settled
  validate(),      // -> { ok, detail } — inspects the REAL DOM
  stats(),         // -> { mountedNodes, stageNodes, records, views, scenario, … }
};
```

- **Settle discipline:** `store.flush()` → `requestAnimationFrame` → `setTimeout(0)` (rAF runs before paint; the timer lands past the committed frame) → two more frames in `runScenario`. A `run()` that resolves early manufactures garbage numbers.
- **`validate()`** is separate from timing, read-only, and re-derives expectations from the store: row counts, full row order, spacer geometry, and whatever the last op claimed.
- `stats().mountedNodes` counts elements under the list container; `stageNodes` is the whole scenario. `run()` bypasses the 50k confirmation arm.

## Scenarios and their gates

| scenario | question | asserted result |
| --- | --- | --- |
| `keyed-list` | what does a fully-mounted keyed list cost? | `mountedNodes === records × 7`; D170 gates at 1,000 rows: `update-one` touches 1 row / 1 child `data()`, `update-all` N / N, `reorder` 0 / 0 with moves only |
| `virtual-list` | same records and row, windowed | `mountedNodes ≤ 200` at any size |
| `subscriptions` | how much wakes when one record changes? | `precision` (`findOne`) 0/100; `fanout` (`findMany`) 100/100 |
| `async-waterfall` | do N async `data()` runs overlap? | serialized: `maxInFlight` 1 of 20 |
| `deep-nest` | is one update proportional to depth or forest? | neither — `nodeDataRuns` 1 (control `update-global`: all 1,536) |
| `write-storm` | does the rAF-batched flush hold; what does persistence cost? | `stormWrites` 5,000 |
| `islands` | does `island` freeze its subtree? | 0 violations; `islandChildVnodesPerRender` 20,000 |
| `formatters` | what does the function library cost over a large re-render? | `count-intl`: 0 `Intl` constructions across 20,000 calls |
| `listener-churn` | what does listener churn cost? | 0 add/remove listener calls in all arms; `click-select` proves the handler reads the current row |
| `route-churn` | how often does a reused route ancestor render per navigation? | 12 ancestor renders per navigation; mutations all at the divergence level |
| `form-state` | what does a keystroke cost a 400-control form? | clean re-render writes 0 input and 0 select values |
| `flip-churn` | what do N rows cost the FLIP path? | exact flip counters for shuffle, no-flip control and in-flight interrupt |
| `loop-trap` | does the D121 loop detector fire in a browser? | both arms at the documented thresholds — probe only |

The **handler A/B** (`handlers-inline/*` vs `handlers-stable/*`) runs `keyed-list` with `@select={ selectRow(row) }` against `@select={ selectById }`, back to back.

## Design rules and gotchas

- **`keyed-list` is deliberately not virtualized.** Its job is to show what `n × 7` live elements cost; windowing it makes the `virtual-list` A/B vacuous. Both share `row-ops.js`, `ListRow.pzl` and one mutation set so neither does less work.
- **`ListRow` takes primitive props, not the record,** so both A/B arms do identical per-row work.
- **Rows carry an explicit `seq`** because `findMany` returns Map-insertion order, which cannot be permuted in place.
- **Counters that must survive production live in the app** (`row-metrics.js`, `nest-metrics.js`, `rc-metrics.js`), incremented at the top of the child's `data()`. `write-storm` and `islands` wrap `store.flush` / `store._persistNow` on the live instance for the run. The runtime is never modified.
- **`KeyedList.watchRows()` arms its `MutationObserver` only for `WATCHED_OPS`** (`update-one`, `update-all`, `reorder`). An observer inside the timed window inflates `create` and `clear` and breaks the cross-release comparison. Unwatched ops report no `klDomMutations`/`klRowsTouched`, and `baseline.json` must not carry them for those ops or the runner flags a counter mismatch. A new gate that asserts those counters adds its op to `WATCHED_OPS`.
- **A scenario's host makes no store query** (`subscriptions`, `loop-trap`): a subscribed parent would re-render all N children and pollute the counter.
- **`route-churn` lives at `/rc/…`** as a sibling subtree with its own layout (`app/rc-routes.js`), because it needs real route nodes. Rejected: a second `PuzzleApp` (`devtools.js` holds one app slot) and nesting under `/` (Home would become a measured ancestor). Dev-build runs must stay paced — the D121 detector distorts render counts — so production is the primary run.
- **`islands` stays at 20,000 child vnodes per render.** [[DECISION-D170-INCREMENTAL-VDOM-LISTS]] caches an island's children only when the seed is static; this seed is a nested `{#for}`. Caching a dynamic seed would break the D44 rule that a remount re-seeds from the template; closing it needs the runtime to own the seed's lifetime. Not built.
- **Each scenario owns its store type** (`nest`, `storm`, `fmt`, `loop`).
- **`form-state`'s bound values carry a `?? ''` fallback** so the compiler does not auto-bind them (D147) — it measures controlled-value patching, not binding.
- **Fixtures are installed directly in `app.js`, not via `--fixtures`** (D98), so `store.seed()` is available and `puzzle build examples/stress` needs no flag.
- **No `window.confirm()`/`alert()`** — a modal blocks the event loop being measured. The 50k guard is a confirming second click; `keyed-list` does not auto-seed above `HEAVY_ROW_THRESHOLD` (20,000).
- **`loop-trap`'s 1000 ms window remembers the previous arm,** so `runArm()` waits it out before arming.
- **The persistence figure is a lower bound:** the probe uses an in-memory storage shim because 2.5 MB exceeds the localStorage quota and `_persistNow` swallows `QuotaExceededError`.
- **Fixed-duration ops are not measurements.** `write-storm`'s `sustained` pair and `islands`' `shell-churn` run on a clock, so they are absent from the baseline.
