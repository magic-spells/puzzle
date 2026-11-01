---
name: D122 — Expose the dev profiler over the DevTools bridge, additively on protocol v1
status: verified
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D100-DEVTOOLS-BRIDGE
  - FILE-DEVTOOLS
  - FILE-DEVPERF
  - DOC-SPEC-BUILD
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D122 — Expose the dev profiler over the DevTools bridge, additively on protocol v1

The bridge (`client-runtime/devtools.js`, D100) carries the D121 profiler to the
DevTools panel: requests `perf:start`, `perf:stop`, `snapshot:profile` and one
event, `perf-warning`, behind the same inline `__PUZZLE_DEV__` probe as every
other touchpoint.

## Decision

- **`PROTOCOL_VERSION` stays 1.** Both ends tolerate unknown names (unknown
  events fall into the panel's event ring; unknown requests fail per call with
  `{ error }`). A bump would put every published app into the hard mismatch state
  and blank every panel.
- **Pull, don't push.** Profile data is polled via `snapshot:profile`; the page
  hook and the panel keep small message rings, so a per-render firehose would
  evict other panels' events. Only `perf-warning` is pushed, when a D121 loop
  guard trips — whether or not a recording is open. Warnings fold into the saved
  profile only while `profile.recording`, so a stopped report stays final.
- **Aggregation lives in the bridge, not devperf.** devperf's totals are
  process-lifetime counters that `measureRenders()` and the console read, and
  rows must be keyed by the bridge's `viewIds`, which the panel cross-links to
  Views. The bridge converts instance → id at event time and holds no strong
  refs (retaining views would leak every view destroyed during a recording).
  Destroyed views keep their rows. devperf passes sinks the subject:
  `sink(event, subject)`.
- **Cause vocabulary is mapped** by `CAUSE_BUCKET` (`props → parent`,
  `local-state`/`render` → `manual`, `initial`/`refresh` → `data`); unmapped
  causes count under their own name.
- **Flush rows join both sides:** only `devtoolsFlush()` has the keys, only
  devperf's `store-flush` has the duration; a one-slot handoff joins them inside
  the same synchronous `flush()` (re-entrant flushes resolve inner-first). The
  row ring caps at `FLUSH_RING` (200); totals are running counters, never summed
  from the ring.
- `build_test.go` pins `snapshot:profile` present in dev and absent in
  production, on top of D121's zero-`bytesInOutput` check.

## Gotchas

- A surprising profile is more often the fixture than the instrument: a fixture
  that regenerates identical rows reads as all-wasted renders, and that reading
  is correct.
