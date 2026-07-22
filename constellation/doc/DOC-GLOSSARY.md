---
name: Puzzle glossary
status: verified
verified_at: '2026-07-22T00:04:05.621Z'
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - DOC-PUZZLE-FILE
  - DOC-DATASTORE
  - DOC-ROUTER
  - DOC-TEMPLATE-SYNTAX
  - DOC-COMPILATION-FLOW
---

# Puzzle glossary

Current terms used by Puzzle documentation. [[DOC-SPEC]] remains authoritative.

**adapter** — A model's remote-data definition. Built-in store reads and writes
use its endpoint; custom `request` calls share the adapter boundary.

**app root** — The project directory containing `app/`,
`puzzle.config.js`, and package metadata.

**collection key / record key** — Store subscription identities for a whole
model type or one primary-keyed record.

**component** — A reusable `.pzl` class rendered inline as a component vnode.
It has props and call-site children but no `<puzzle-view>` DOM wrapper.

**controlled property** — Form/boolean properties such as `value`, `checked`,
`selected`, or `disabled` synchronized as DOM properties during patches.
Puzzle does not infer a two-way state assignment; event handlers update state.

**data layer** — The model values returned by the latest successful `data()`.
It is replaced on refresh and sits below persistent local state.

**default children** — Content written inside a component invocation and placed
by the child with `<children/>`. The retired lowercase bare `<slot/>` spelling
is a compile error.

**development-state transfer** — One-shot session snapshot/restore used by
`puzzle dev` full-page reloads for store records and JSON-safe local view data.
It is not per-module hot replacement.

**formatter** — A display transformation used in interpolation pipes. Built-ins
are tree-shaken from template use; apps may register custom functions.

**island** — A host element whose children become browser/third-party-owned
after mount. Puzzle continues patching the island element but not its subtree.

**layout** — A routed PuzzleView wrapping a route chain. `<Slot/>` marks the
router outlet.

**local layer** — Persistent component state changed by `setData()`. It
overrides same-named model values and renders without rerunning `data()`.

**model / record** — A `PuzzleModel` subclass defines schema and behavior; a
record is a stable instance stored by type and primary key.

**morph** — Optional shared-element transition integration identified by
`data-puzzle-morph*` attributes. It complements, rather than replaces, router
transitions.

**named slot** — A child insertion point declared with `<slot name=\"…\">` and
filled by a direct call-site child carrying a static `slot=\"…\"`.

**navigation token** — Monotonic router identity preventing stale async loads or
transitions from committing over a newer navigation.

**prerender / static build** — Build-time execution and serialization of static
routes. The browser receives the normal SPA bundle; this is not request-time SSR
or hydration.

**PuzzleApp** — Application owner for configuration, shared context, router
startup, lifecycle, and teardown.

**PuzzleModel** — Base class for schema-backed records.

**PuzzleView** — Plain component/view/layout base class with props, route
snapshot, data/local layers, lifecycle, refs, memoization, and render hooks.

**router outlet** — Capitalized bare `<Slot/>`, where a routed child mounts.

**scoped styles** — A `<styles scoped>` block wrapped in native `@scope` and
anchored by a stable compiler-generated root attribute.

**skeleton** — Optional first-load placeholder declared with
`<puzzle-skeleton>`, with an optional minimum duration.

**store** — Per-app record registry, query/subscription engine, adapter
orchestrator, and optional persistence owner.

**ViewNode / ViewManager** — The virtual-node representation and the runtime
that mounts, diffs, patches, composes, and destroys it.

**write sync** — Explicit `save()`, `delete()`, or adapter `request()`
operations. Local writes validate first; reads upsert authoritative server data.
