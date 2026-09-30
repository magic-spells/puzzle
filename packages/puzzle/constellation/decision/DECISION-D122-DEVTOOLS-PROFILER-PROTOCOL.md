---
name: D122 — Expose the dev profiler over the DevTools bridge, additively on protocol v1
status: verified
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D100-DEVTOOLS-BRIDGE
  - FILE-DEVTOOLS
  - FILE-DEVPERF
  - DOC-SPEC-BUILD
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D122 — Expose the dev profiler over the DevTools bridge, additively on protocol v1

The bridge (`client-runtime/devtools.js`, D100) adds requests `perf:start`,
`perf:stop`, `snapshot:profile` and one event, `perf-warning`, behind the same
inline `__PUZZLE_DEV__` probe as every other touchpoint.

## Decision

- **`PROTOCOL_VERSION` stays 1.** Both ends tolerate unknown names (unknown
  events fall into the panel's event ring; unknown requests fail per call with
  `{ error }`). A bump would put every published app into the hard mismatch state
  and blank every panel.
- **Pull, don't push.** Profile data is polled via `snapshot:profile`; the page
  hook buffers 500 messages and the panel ring 200, so a per-render firehose would
  evict other panels' events. Only `perf-warning` is pushed, when a D121 loop
  guard trips — unconditionally, recording or not. Warnings fold into the saved
  profile only while `profile.recording`, so a stopped report stays final.
- **Aggregation lives in the bridge, not devperf.** devperf's totals are
  process-lifetime counters `measureRenders()` and the console read; and rows must
  be keyed by the bridge's `viewIds`, which the panel cross-links to Views.
  Aggregating at the bridge converts instance → id at event time and holds no
  strong refs (devperf retaining views would leak every view destroyed during a
  recording). Destroyed views keep their rows. devperf passes sinks the subject:
  `sink(event, subject)`.
- **Cause vocabulary is mapped** by `CAUSE_BUCKET` (`props → parent`,
  `local-state`/`render` → `manual`, `initial`/`refresh` → `data`); unmapped
  causes count under their own name.
- **Flush rows join both sides:** only `devtoolsFlush()` has the keys, only
  devperf's `store-flush` has the duration; a one-slot handoff joins them inside
  the same synchronous `flush()` (re-entrant flushes resolve inner-first). The
  row ring caps at 200; totals are running counters.
- `build_test.go` pins `snapshot:profile` present in dev and absent in prod, on
  top of D121's zero-`bytesInOutput` check.

## Reading profiles

A surprising reading is more often the fixture than the instrument: the stress
app's all-wasted `ListRow`s were true positives (a reset fixture seed regenerated
identical rows). Nothing short-circuits identical data before render and diff —
the per-value comparison in patching is the only thing between a no-op update
and a DOM write.
