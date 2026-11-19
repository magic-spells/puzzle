---
name: D191 — setState() and getState() name the state layer; setData() is removed
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC-ANATOMY
  - DOC-RELEASE-SURFACE
  - DECISION-D23-REFRESH-PATTERN
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D100-DEVTOOLS-BRIDGE
---

## Context

A view has two layers of state ([[DOC-SPEC-ANATOMY]] §4): the state layer its own code writes, and the derived layer each `data()` commit replaces. `getData()` returns the two merged. The writer was called `setData()`, which read as "set what `getData()` returns" and hid that it writes only one layer, the one `data()` never owns. Nothing public read the state layer alone; the HMR snapshot (D57) and the DevTools bridge (D100) reached it through an internal `_state()`.

## Decision

- `setState(key, value)` / `setState(partial)` writes the state layer and schedules a re-render. It is the old `setData()` under a new name, with identical behavior.
- `getState()` returns a fresh shallow copy of the state layer alone, without `data()`'s values over it. It replaces the internal `_state()` reader, so the HMR snapshot and the DevTools bridge use the public method.
- `getData()` is unchanged: a fresh shallow copy of the merged model the template reads.
- `setData()` is removed outright in 0.10.0, with no alias and no warning. The framework is pre-1.0 and has no outside users yet, so a deprecation cycle would only keep a second spelling alive.

## Alternatives rejected

- **Keep `setData()` as a deprecated alias for a release.** Two spellings for one write, in docs, examples and agent-written code, for users who do not exist yet.
- **Keep `setData()` and add only `getState()`.** Leaves the write named after the merged view it does not write.
- **Rename `getData()` too.** It really does return the whole model; the template-facing read keeps its name.

## Consequences

Every call site moved to `setState()` in the same change: runtime, tests, Pieces, DevTools, examples, docs and the VS Code snippet (`psetstate`). DOM methods with the same name, such as `DataTransfer.setData()`, are unrelated and unchanged. The DevTools wire keys `model` / `local` keep their names.
