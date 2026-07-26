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

## Verified end to end

Confirmed in real Chrome against `examples/stress` on a `puzzle dev` build: the
panel connects, records, and populates. `create-10k` on the real-DOM list
reported 10,003 renders / 198,122 DOM mutations / 10,002 views across a SINGLE
store flush notifying ONE subscriber in 405 ms; the same op on the windowed list
reported 28 renders / 114 mutations / 27 views, flush 2.1 ms. Batching, the
pull-not-push design, and the shared view-id space all behave as specified.

## Open question: zero-mutation child renders in the stress app

On `examples/stress`, every mounted `ListRow` reported `DOM 0` / `wasted 1` /
`100%` while its parent absorbed the mutations, which looked like a systematic
mount-attribution fault in `mutationImpl` (`devperf.js:530`, which credits the
innermost render mark still open and skips any already `ended`).

**A later run on `examples/photo-gallery` contradicts that.** There, every
mounted `PhotoCard` records its OWN mutations — `DOM 19` each, `wasted 0` —
alongside `GalleryView` at 72. So child mount mutations ARE attributed to the
child on that path, and the attribution logic is not broken in general.

The `ListRow` case therefore has some other cause and is not yet diagnosed.
Candidates: the rows were already mounted and genuinely re-rendered to nothing
(a true positive, not a defect), or the shared-component path used by both list
scenarios differs from an ordinary `{#for}` component mount. Do not act on the
mount-attribution theory until this is reproduced and isolated.

## Confirmed: layouts and views render twice per navigation

The `photo-gallery` recording is a clean navigation-only sample — 0 store
flushes, 0 notifications, so every render came from routing. Across a handful of
route changes: `DefaultLayout` 6 renders (18 mutations, 6.7ms patch),
`AlbumView` 6 renders of which **3 wasted (50%)**, `AlbumIndex` 3 renders of
which 2 wasted (67%).

That is the predicted double-render: the router pushes the new chain through the
reused layout via slot-only `applyParentUpdate`, then calls `#refreshLogged`
after commit, so each reused ancestor renders twice per committed navigation and
the second pass frequently produces nothing.
