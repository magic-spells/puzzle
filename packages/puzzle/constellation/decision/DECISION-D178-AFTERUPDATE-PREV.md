---
name: 'D178 — afterUpdate(prev): the previous props, params, route and data as an argument'
status: planned
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

`afterUpdate` receives one argument, `prev`: a frozen, shallow snapshot taken
just before the update.

```js
afterUpdate(prev) {
  if (prev.props.center !== this.props.center) this.map.setCenter(this.props.center);
}
```

- `prev` holds `props`, `params`, `route` and `data` (the merged `getData()`
  result). It leaves out `refs`, `element` and `ctx`.
- `mounted()` covers the first render, so `afterUpdate` always gets a real
  `prev`.
- Records keep identity across mutations (D170), so `prev.data.post !==
  this.getData().post` only detects a *different* record; compare fields to
  catch an edit to the same one.
- Existing `afterUpdate()` overrides keep working unchanged: the argument is
  simply ignored.
- The snapshot is taken only for a view class that defines `afterUpdate`, so
  views without the hook pay nothing.
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

One shallow copy of four references per update, for views that define the
hook.
