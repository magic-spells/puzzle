---
name: Compiled app anatomy
status: built
connections:
  - DOC-SPEC
  - DOC-ARCHITECTURE
  - DOC-COMPILATION-FLOW
  - DOC-VIEW-LIFECYCLE
  - DOC-EVENTS
  - FLOW-REACTIVITY
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
---

# Compiled app anatomy

An end-to-end trace of a running Puzzle app.

## 1. Build output

Each imported `.pzl` becomes an ES module: the author's class plus a generated
prototype `render()`. esbuild links them with the entry (`app/app.ts` or
`app/app.js`), the runtime and styles into `dist/app.js` and
`dist/styles.css` (a linked `.map` only with `build.sourceMap: true`); public
assets are copied beside them. `output: 'hybrid'` adds route HTML the SPA
takes over; `output: 'static'` emits pages with no router or `app.js`.

## 2. Boot

`new PuzzleApp({ target, routes, models, formatters, i18n, … })`, then
`mount()`:

1. validate config; create the store, function registry and router context;
2. run `beforeMount`;
3. restore a one-shot development snapshot when present;
4. start the router and resolve navigation zero (layout/route chain preloaded);
5. mount the vnode tree; commit route, title and scroll;
6. run `mounted`.

A failure before commit leaves no half-mounted app.

## 3. View load

For each incoming view or component the runtime sets props and route context
and evaluates `data(params, props)`, tracking store queries. The newest
successful result replaces the model layer, `setData()` values overlay it, and
`render()` produces a ViewNode tree. A skeleton may render during the first
async load. Reused routed ancestors refresh with the merged params before the
navigation commits ([[DOC-VIEW-LIFECYCLE]]).

## 4. DOM composition

[[COMPONENT-VIEW-MANAGER]] creates or patches the DOM for host nodes,
components, text, SVG, refs, listeners, controlled properties, islands, and
markers: `<Children/>` places default call-site content, `<Slot name="…"/>`
named content (nothing when unfilled), bare `<Slot/>` the routed child view.
Keyed children move by identity. Item-form `{#for}` rows and static subtrees
are cached between renders.

## 5. Reactive event


DOM listener → compiled handler → arrow function in the view's `events` →
model/store mutation → batched notification → subscribed `data()` rerun →
render → diff → patch. A local-only interaction calls `setData()`; when model
values derive from that state, the handler also calls `refresh()`. Component
`@event` bindings are callback props, not DOM events ([[DOC-EVENTS]]).

## 6. Navigation

A link or `router.push()` resolves a route chain and a token. Incoming work
loads before anything visible changes; then transitions/morphs run, the
changed subtree mounts or patches, and URL, title, current route and scroll
commit together. Superseded work destroys only its own fresh instances.

## 7. Teardown

Unmount stops routing, flushes pending persistence, destroys the routed tree,
disconnects observers and animations, removes listeners and subscriptions,
runs `destroyed` hooks, then app `beforeUnmount`. A cleanup error is reported
without stopping the rest.
