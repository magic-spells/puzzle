---
name: Compiled app anatomy
status: verified
verified_at: '2026-07-22T00:04:04.410Z'
connections:
  - DOC-SPEC
  - DOC-ARCHITECTURE
  - DOC-COMPILATION-FLOW
  - DOC-VIEW-LIFECYCLE
  - DOC-EVENTS
  - DOC-DECISIONS
  - FLOW-REACTIVITY
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
---

# Compiled app anatomy

An end-to-end trace of a running Puzzle application.

## 1. Build output

Each imported `.pzl` file becomes an ES module containing the user's class and
a generated prototype `render()`. esbuild links those modules with
`app/app.js`, the Puzzle runtime, application JavaScript, and styles into
`dist/app.js`, its linked map, and `dist/styles.css`. Public assets are
copied beside them.

Static mode also produces route HTML. The same SPA bundle still owns subsequent
navigation.

## 2. Boot

Application code constructs `PuzzleApp` with a target, routes, models,
formatters, storage/router/transition options, and optional app lifecycle hooks.

Mounting proceeds as:

1. validate config and create formatter/store/router context;
2. run `beforeMount`;
3. restore a one-shot development snapshot when present;
4. start the router and resolve navigation zero;
5. preload the layout/route chain;
6. mount the vnode tree into the target;
7. commit route/title/scroll state;
8. run `mounted`.

A failure before commit does not present a half-mounted application.

## 3. View load

For each incoming view or component, the runtime sets props/route context and
evaluates `data(params, props)` while tracking store queries. The newest
successful evaluation replaces the model layer. Local values from `setData()`
overlay it, then `render()` produces a ViewNode tree.

On first async load, an optional skeleton may render until the real result
commits. Reused routed ancestors also refresh with the incoming merged params
before navigation commit. See [[DOC-VIEW-LIFECYCLE]] for the per-view lifecycle
state machine.

## 4. DOM composition

[[COMPONENT-VIEW-MANAGER]] creates or patches real DOM. Host nodes, component
vnodes, text, SVG, refs, event listeners, controlled properties, islands, and
composition markers all use the same tree.

- `<children/>` inserts default component call-site content.
- `<slot name>` inserts named content or fallback.
- `<Slot/>` inserts the routed child view.
- Keyed children move by identity rather than remounting by index.

## 5. Reactive event

A typical click follows:

`DOM listener` → compiled handler → arrow function in `events` → model/store
mutation → batched record/collection notification → subscribed `data()` rerun
→ render → diff → patch.

A local-only interaction can call `setData()` and render without touching the
store. If model values are derived from that local state, the handler calls
`refresh()` to rerun `data()`. Component `@event` bindings are callback props,
not custom DOM events — see [[DOC-EVENTS]].

## 6. Navigation

A link or `router.push()` resolves a route chain and token. Incoming work loads
before visible state changes. The router then runs transition/morph hooks,
mounts or patches the changed subtree, and commits URL, title, current-route,
and scroll behavior together. Superseded work destroys only its fresh
instances.

## 7. Teardown

Unmount stops routing, flushes pending persistence, destroys the routed tree,
disconnects observers/animations, removes events and subscriptions, runs
component `destroyed` hooks, then runs app `beforeUnmount`. Cleanup errors are
reported without preventing the remaining teardown work.
