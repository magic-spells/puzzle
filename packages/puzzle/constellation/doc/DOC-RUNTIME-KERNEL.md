---
name: Runtime kernel
status: built
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

The browser runtime is plain JavaScript modules exported by
`@magic-spells/puzzle`. The core is compiler-independent: tests can mount
handwritten render functions without Go.

## Application and views

[[COMPONENT-PUZZLE-APP]] validates config, builds the store, function registry,
optional i18n and router context, runs app lifecycle hooks, restores
development state, starts navigation zero, and tears down in reverse.

[[COMPONENT-PUZZLE-VIEW]] is one plain class for routed views, layouts and
components. A view owns immutable props and a per-navigation route snapshot;
a replace-on-success model layer from `data(params, props)`; a persistent
local layer from `setData()`; the subscriptions gathered while `data()` runs;
refs, memoized values, lifecycle and animation declarations; and the
compiler-attached `render()`. Async commits are last-wins; skeletons apply to
the first load only and may hold a minimum duration.

## Rendering

[[COMPONENT-VIEW-MANAGER]] mounts, diffs and patches ViewNode trees: keyed
moves, controlled form properties, events and modifiers, SVG namespaces,
component instances, default/named composition, router outlets, refs, islands
and teardown. Conditionals keep sibling positions with invisible placeholders;
call-site children execute in the parent's scope.

`<Component>` (D180) uses `dynamicComponent` to put an ordinary constructor vnode in a stable comment-bracketed range. The normal component mount/patch path keeps reactive props, events, DevTools ownership and teardown. A constructor change releases the outgoing instance before mounting, including an animated instance; nullish selection leaves an empty range. Ordinary removal runs the chosen child's hide/leave path. Component-root ranges resolve their complete end recursively for keyed moves, replacements and error recovery. `__PUZZLE_HAS_COMPONENT_SLOT__` removes this range handling from apps without the built-in tag.

Each render rebuilds only part of the tree. A maximal static subtree is
allocated once per instance (or per row); an item-form `{#for}` is a
persistent list block that returns a row's previous subtree unless that row's
inputs changed. `patch()` short-circuits on identical objects, with two
carve-outs: a live component's element link is refreshed, and controlled form
values inside a cached row are re-asserted against the live DOM.

## Data and routing

[[COMPONENT-STORE]] keeps stable record identities, runs tracked queries,
batches notifications, loads and saves through the adapter capability,
persists optionally, and isolates subscriber failures.
[[COMPONENT-PUZZLE-MODEL]] provides schema-backed records, validation,
relationships, immutable primary keys and safe server assignment; reads upsert
without authoring validation, local writes validate first.

[[COMPONENT-ROUTER]] resolves nested chains, preloads fresh and reused views,
and commits atomically: path routing by default, hash and memory through
`@magic-spells/puzzle/router-modes`, plus layouts, base paths, titles,
anchors, scroll restoration, transitions, and failure-safe cancellation.

## Specialized layers

[[COMPONENT-FORMATTERS]] (the function library, tree-shaken per app),
[[COMPONENT-ANIMATIONS]] (WAAPI and visible triggers), optional morph,
[[COMPONENT-DEVSTATE]] (development only), and the SSG serializer, which runs
the same render model without a browser DOM.

## Kernel invariants

- Store, prop and route refreshes rerun `data()`; `setData()` alone does not.
- A stale async evaluation or navigation token never commits.
- Prop diffing is shallow, except that a store record also compares by render
  revision, so a record prop refreshes its child on that record's own
  mutations. A related record, a computed getter's inputs, or a direct field
  assignment advance no revision — query in the child for those.
- Framework-owned fields and prototype-pollution keys are never assigned from
  server or persisted data.
- Destroy removes listeners, observers, subscriptions, refs, animations and
  nested components.
