---
name: Runtime kernel
status: verified
verified_at: '2026-07-22T00:04:05.947Z'
connections:
  - DOC-SPEC
  - DOC-ARCHITECTURE
  - FLOW-REACTIVITY
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-ANIMATIONS
  - COMPONENT-DEVSTATE
---

# Runtime kernel

The browser runtime is a set of plain JavaScript modules exported by
`@magic-spells/puzzle`. The core stays compiler-independent: tests can mount
handwritten render functions without invoking Go.

## Application

[[COMPONENT-PUZZLE-APP]] validates config, constructs the store/formatters/router
context, runs app lifecycle hooks, restores development state when present,
starts initial navigation, and tears everything down in reverse order.

## Views and component state

[[COMPONENT-PUZZLE-VIEW]] is a plain class used by routed views, layouts, and
inline components. A view owns:

- immutable current props and a per-navigation route snapshot;
- a replace-on-success model layer from `data(params, props)`;
- a persistent local layer changed by `setData()`;
- subscriptions gathered while `data()` evaluates;
- refs, memoized values, lifecycle and animation declarations;
- a compiler-attached `render()` method.

Async data commits are last-wins. Skeletons apply only to the initial load and
may opt into a minimum visible duration.

## Rendering and composition


[[COMPONENT-VIEW-MANAGER]] mounts, diffs, and patches ViewNode trees. It owns
keyed moves, controlled form properties, events/modifiers, SVG namespaces,
inline component instances, default/named composition, router outlets, refs,
islands, and deterministic teardown.

The tree handed to it is only partly rebuilt each render. A maximal static
subtree is allocated once per view instance (or once per list row) and returned
by reference afterwards; an item-form `{#for}` is a persistent list block that
keeps one row state per key and returns the row's previous vnode subtree unless
that row's inputs changed. `patch()` short-circuits when both sides are the
same object, so a cached subtree costs a pointer comparison — with two
carve-outs: a live component's element link is refreshed, and controlled form
values inside a cached row are re-asserted against the live DOM.

Compiled conditionals preserve sibling positions with invisible placeholders.
Children passed into a component execute in the parent scope; the child decides
where they appear with `<Children/>` or named `<Slot name="…"/>` markers.

## Data

[[COMPONENT-STORE]] retains stable model identities, performs tracked queries,
batches record/collection notifications, loads/saves/deletes through adapters,
hydrates/persists optional browser storage, and isolates subscriber failures.

[[COMPONENT-PUZZLE-MODEL]] provides schema-backed records, getters/methods,
validation, relationships, immutable primary keys, and safe server assignment.
Reads upsert without enforcing local authoring validation; local writes validate
before mutation/sync.

## Routing

[[COMPONENT-ROUTER]] resolves nested route chains, preloads fresh/reused views,
and commits navigation atomically. It supports history/hash/memory modes,
layouts and `<Slot/>`, base paths, titles, anchors, restoration, custom scroll
behavior, sequential or overlapping transitions, and failure-safe cancellation.

## Specialized layers

- [[COMPONENT-FORMATTERS]] supplies built-ins and app formatters through a
  tree-shaken manifest.
- [[COMPONENT-ANIMATIONS]] schedules WAAPI enter/leave and visible-trigger work.
- Optional morph integration uses lifecycle hooks without changing router
  ownership.
- [[COMPONENT-DEVSTATE]] exists only in development bundles.
- The SSG serializer executes the same render model without browser DOM.

## Kernel invariants

- Store/prop/route refreshes rerun `data()`; `setData()` alone does not.
- A stale async evaluation or navigation token never commits.
- Component prop diffing is shallow, with one addition: a store record also
  compares by render revision against the snapshot the child stored when props
  were last applied, so a record prop invalidates its child on that record's own
  mutations. Everything else compares by reference — pass stable identities, and
  query in the child for a related record, a computed getter, or anything a
  direct field assignment changed.
- Framework-owned fields and prototype-pollution keys cannot be assigned from
  server or persisted data.
- Destroy removes listeners, observers, subscriptions, refs, animations, and
  nested components.
