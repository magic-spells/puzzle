---
name: 'D178 — afterUpdate(prev): the previous props, params, route and data as an argument'
status: built
connections:
  - DOC-SPEC-VIEW
  - DOC-VIEW-LIFECYCLE
---

# D178 — `afterUpdate(prev)`

## Context

`afterUpdate()` is where a view syncs things Puzzle does not render (a map, a
chart, scroll, focus) after an update that came from outside the view.
Deciding *what* changed means comparing against the old value, and today the
view has to stash that value on the instance itself.

## Decision


`afterUpdate` receives one argument, `prev`: a frozen, shallow snapshot of what
the previous render drew.

```js
afterUpdate(prev) {
  if (prev.props.center !== this.props.center) this.map.setCenter(this.props.center);
}
```

- `prev` holds `props`, `params`, `route` and `data` (the merged `getData()`
  result). It leaves out `refs`, `element` and `ctx`. Type: `PrevViewState`.
- **The snapshot is taken as each render lands**, in `#renderNowInner` (the
  one place the runtime calls the hook), and handed to the next update. Taking
  it when an update starts would be too late: `setData()` writes the data
  immediately and `refresh()` swaps props, params and route before `data()`
  runs. The mount render is snapshotted too, so the first `afterUpdate` gets a
  real `prev`.
- `props`, `params` and `route` are referenced (the runtime replaces them,
  never mutates them); `data` is mutated in place, so it is shallow-copied and
  the copy frozen.
- **A record in `prev` is the same live object** — the snapshot is shallow and
  records keep identity across their own mutations (D170). `!==` detects a
  *different* record; to catch an edit to the same one, return the field from
  `data()` (`title: post.title`) and compare that.
- **With an async `data()`**, a `setData` render that lands while a
  `refresh({ props })` is pending reports the prop change with the old data;
  the refresh's render then reports the data change with no prop change. Each
  change is reported exactly once. React to `prev.data`, not props, when the
  work depends on what `data()` returned.
- Existing `afterUpdate()` overrides keep working unchanged.
- The snapshot is taken only for a view class that overrides `afterUpdate`;
  other views pay one comparison per render.
- Prerender never calls `afterUpdate`, so it never builds a snapshot.

## Alternatives rejected

- **A watcher or effect primitive** (`watch`, `$effect`) — `data()` owns
  derived state and handlers own user-driven side effects; a reactive
  primitive would add a second way to do both.
- **Per-field change callbacks** (`propChanged(name, old, new)`) — a new hook
  per concern, and it cannot express "either of these two changed".
- **A deep snapshot** — cost grows with the data, and record identity already
  answers the common question.

## Consequences


For a view that defines the hook: one frozen object and one shallow copy of
its data per render. About 30 bytes gzip in every bundle. Built in PR #208;
tests in `tests/view.test.js` and `tests/router-ancestor-transaction.test.js`.
