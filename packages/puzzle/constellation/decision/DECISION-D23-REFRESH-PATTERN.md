---
name: "D23 — setState() re-runs data() when data() read the written key"
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-USER-GUIDE
  - DOC-SPEC-ANATOMY
  - FLOW-REACTIVITY
  - DECISION-D191-SET-STATE-GET-STATE
---

# D23 — `setState()` re-runs `data()` when `data()` read the written key

## Decision

While `data()` runs, the runtime records every key it reads through `getData()` or `getState()`. Enumerating a copy (a spread, `Object.keys`, `JSON.stringify`) counts as reading every key, including keys written later. A successful commit keeps that run's keys.

`setState()` always writes the state layer and schedules a render ([[DOC-SPEC-ANATOMY]] §4). When it writes a key the last committed `data()` read, the scheduled render re-runs `data()` first. Every write before that render lands in the state layer, so a burst of writes costs one `data()` run and one render. A key `data()` never read only re-renders, as before.

So a filter tab narrowing a list is `this.setState('filter', 'done')` and nothing else. `refresh()` is for re-running `data()` on purpose: when it derives from something the runtime cannot see (an instance field, a module variable, the clock), or when the caller needs the new model rendered before its next line runs.

Details:

- A sync `data()` commits and renders inside the flush. An async `data()` is started by the flush, which renders the written values at once; the commit renders again when it resolves. Last-wins applies as for any refresh.
- A view mid-settle ([[DECISION-D161-AUTO-FETCHING-FINDS]]) folds the write into that run as one more pass.
- A `setState()` made while `data()` itself is running never schedules a re-run, so `data()` cannot loop on its own writes. Writes after an `await` in an async `data()` are ordinary writes.
- In an async `data()`, only `getData()`/`getState()` calls made before the first `await` are tracked. A copy taken there keeps recording after it; a call made after it records nothing. Read state before the first `await`.
- An explicit `refresh()` clears a pending re-run, so `setState()` then `refresh()` still runs `data()` once.
- A sync `data()` throw on the re-run goes to the error funnel with phase `refresh`, like a store-change refresh.

## Alternatives rejected
- **`setState()` never re-runs `data()`, `refresh()` by hand** (the rule until 0.10.0). Every derived value needed a `refresh()` after the write, and agent-written code added it after writes that fed nothing.
- **`setState()` always re-runs `data()`.** Re-runs fetching `data()` on every keystroke into a field it never reads.
- **Declared dependencies** (a `watch` list, computed keys). A second place to keep in sync with what `data()` already says by reading.
- **Moving pure UI state into the store.** Heavyweight.
