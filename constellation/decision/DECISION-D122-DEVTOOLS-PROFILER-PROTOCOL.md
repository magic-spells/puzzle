---
name: D122 — Expose the dev profiler over the DevTools bridge, additively on protocol v1
status: building
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D100-DEVTOOLS-BRIDGE
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - FILE-DEVTOOLS
  - FILE-DEVPERF
  - DOC-SPEC-BUILD
---

# D122 — Expose the dev profiler over the DevTools bridge, additively on protocol v1

D121 built the profiler but deliberately scoped DevTools protocol changes OUT, so
`devperf.js` had an in-process API and nothing else. The extension's Performance
panel was written against a protocol the runtime did not speak. This card covers
the seam.

## Decision

Add three requests — `perf:start`, `perf:stop`, `snapshot:profile` — and one
event, `perf-warning`, to `client-runtime/devtools.js`, behind the same inline
`__PUZZLE_DEV__` probe as every other bridge touchpoint.

### PROTOCOL_VERSION stays 1

The message set grows additively. Unknown events already fall through the
extension's `receive()` default case into the event ring, and unknown requests
already fail per-call with `{ error }`, so both ends tolerate names they do not
know. Bumping to 2 would put every published `0.3.1` app into the hard `MISMATCH`
state and blank *every* panel — a far worse regression than one panel reporting
that a given runtime has no profiler.

### No per-render event

Render data is PULLED via `snapshot:profile` while recording, not pushed. The
page hook buffers 500 messages pre-attach and the panel ring holds 200, so a
per-render firehose would evict the events the other five panels depend on. Only
`perf-warning` is pushed, and only when a loop guard trips.

### Aggregation lives in the bridge, not in devperf

`devperfSnapshot()` was NOT reshaped into the report format. Two reasons, and the
second is the load-bearing one:

1. devperf's totals are process-lifetime counters that both `measureRenders()`
   and the console handle read. Making them recording-scoped would break both.
2. Rows must be keyed by the id the *bridge* hands out (the `viewIds` WeakMap),
   because the panel cross-links profile rows into the Views panel by that id.
   If devperf accumulated rows for later id-remapping it would have to retain
   view references — pinning every view destroyed during a recording, so a long
   profiling session would leak the very views it profiles. Aggregating at the
   bridge converts instance → id at event time and holds no strong refs.

A consequence worth keeping: destroyed views keep their rows, which is exactly
the panel's "no longer mounted" case, for free.

`devperf.js` therefore passes each sink the subject instance as a second
argument (`sink(event, subject)`). No event payload changed shape.

### Cause vocabulary is mapped, not renamed

devperf's causes (`initial`, `refresh`, `store`, `props`, `route`, `local-state`,
`render`, `slots`) do not match the report's six buckets. A `CAUSE_BUCKET` map
translates — notably `props → parent`, `local-state`/`render` → `manual`,
`initial`/`refresh` → `data`. Unmapped causes are counted under their own name
rather than dropped, which the panel's `causeSummary` appends.

### Flush rows are joined from both sides

Only `devtoolsFlush()` carries the changed keys; only devperf's `store-flush`
event carries the duration. A one-slot handoff joins them inside the same
synchronous `flush()`. Re-entrant flushes resolve correctly because the inner one
completes first. The row ring caps at 200, but `storeFlushes` and
`storeNotifications` totals come from running counters, so a long recording does
not under-report.

## Zero production bytes still holds

Unchanged from D121, and verified more strictly: the change was stashed, the
bundle rebuilt, and the hashes compared. `examples/todos` production `app.js` is
**byte-identical** at 63,796 bytes, `sha256 4641cb51…18ff7` either way — which
satisfies the SPEC §56 oracle trivially, since it is literally the same file.
`build_test.go` now pins `snapshot:profile` in both the dev-retains and
prod-DCE halves.

## Not yet verified

The runtime side was tested against a fake hook and the panel side against the
synthetic double at `test/fixture-page/index.html`. **The two have never spoken
to each other in a real browser.** Until an unpacked `dist-extension/` is loaded
against a running app and the Performance panel populates, this card's
integration claim is unproven — the shapes match by construction and by reading,
not by observation.
