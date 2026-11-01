---
name: Shared route-flatten module
status: verified
path: client-runtime/router/routeTree.js
language: javascript
summary: The single source of the nested-routes → per-leaf flatten both the Router and the SSG prerenderer walk.
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# routeTree.js

The one nested-routes → per-leaf flatten (`walkRouteTree`, `joinPath`). The Router (its matcher table) and the SSG prerenderer (`enumerateRoutes`) both walk `children` through it, so they agree on the leaf set and composed paths — otherwise a navigable route fails to prerender, or a prerendered page never matches. Each consumer keeps its own work (chain validation and regex compilation vs. inherited-layout extraction) inside the `makeLeaf` callback it passes in.

DOM-free and import-free, so it runs in the browser bundle and under Node. `tests/route-tree-shared.test.js` asserts that SSG enumeration and the router table agree — never fork the walk back into either consumer.
