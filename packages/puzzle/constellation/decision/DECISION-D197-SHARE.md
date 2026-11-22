---
name: D197 — data() takes one object, and share() hands values to nested views
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-ANATOMY
  - DOC-PUZZLE-FILE
  - DOC-RELEASE-SURFACE
  - FLOW-REACTIVITY
  - DECISION-D23-REFRESH-PATTERN
  - DECISION-D191-SET-STATE-GET-STATE
---

## Context

`data(params, props)` took two positional arguments. Any third input (values an ancestor hands down, and later built-ins such as `query`) would have grown the list further, and most components already ignored `params`, so they wrote `data(_params, props)` or `data(params, props)` with an unused first argument.

Compound components (`Tabs` with `Tab`, a nested `Filter` chain, a `Form` with its fields) need the inverse of props: a parent hands state and callbacks to views it renders at any depth, including children passed through a slot, without every level re-declaring a prop. Threading props through slots is not possible at all, since the slot's author never sees the child's props.

## Decision

- **`data()` takes one object:** `data({ params, props, shared })`. `params` is the route params, `props` the props, `shared` what ancestors share. A component destructures only what it uses; `params`, `props` and `shared` are reserved names in that object, and future built-ins join the same object. The base class still returns `props`.
- **`share()` is an optional method** next to `data()`. It receives the same object (with the view's own inherited `shared`), runs synchronously after every `data()` commit, and returns the values and callbacks nested views get.
- **Keyed by camelCase class name.** A descendant reads the sharer's return under `shared.<camelCaseName>`: `Tabs` → `shared.tabs`, `FilterPanel` → `shared.filterPanel`, `URLBar` → `shared.urlBar`. Production builds minify class names, so the compiler stamps `Class.__share = '<key>'` on any class whose script declares `share`; the runtime derives the key from `View.name` only when the stamp is missing.
- **`shared` is always an object.** `{}` when no ancestor shares, so `data({ shared: { filter = {} } })` never throws.
- **Who sees it:** every view the sharer's render tree mounts (the owner chain, `__parent`), which includes slotted children because slot content mounts inside the component that renders it. The nearest same-named ancestor wins. The walk stops at a routed view: the router preloads layouts and pages in parallel, so a layout's `share()` cannot reach its page.
- **Children change the sharer only through its callbacks.** There is no `setShared()` and no access to the parent's `setState()`. A function value reaches children as a stable wrapper that always calls the newest closure, so a re-run that makes a new arrow function never counts as a change.
- **Reactivity reuses D23.** `share()` runs under the same read recorder as `data()`, so a `setState()` of a key it read re-runs `data()` and then `share()`. Each descendant's `data()` records which `shared` keys it read; after `share()` re-runs, only descendants that read a key whose value changed (`Object.is`) re-run, synchronously before the sharer renders.
- **Handlers read `this.shared`**, an untracked getter returning the same object `data()` gets.
- **The compiler warns on a component named `Params`, `Props` or `Shared`**, since its shared key would read like a built-in.

## Alternatives rejected

- **Keep positional arguments and add a third.** Every new input lengthens the list and keeps the `_params` placeholder alive.
- **React-style context with providers and `useContext`.** Needs a provider element in the template and a lookup key object; a class name already names what a component shares.
- **Let children call `setShared()` or the parent's `setState()`.** Two writers for one piece of state; a callback keeps the sharer in charge of its own rules.
- **Pass shared values down the router chain (layout → page).** Layout and page `data()` run in parallel on navigation, so the page cannot wait for the layout's `share()` without serializing every route load.
- **Re-run every descendant whenever `share()` re-runs.** Correct but wasteful on large trees; per-key read tracking is the same mechanism `data()` already uses for `getData()`.

## Consequences

Every `data()` signature moved to the object form in the same change: runtime, tests, Pieces (registry and demo), examples, init and generator templates, docs and the agent skill. The VS Code `data()` snippets live in the separate `puzzle-vscode` repo and move with that repo's own release. A component left on the old signature receives the input object as its first argument, so `params.id` reads `undefined` and `props` is `undefined`: it fails at the first prop read, not silently. `share()` must be synchronous; store queries belong in `data()`, read back through `getData()`. The `__retryParent` link is renamed `__parent`, since sharing and error retry now both walk it.
