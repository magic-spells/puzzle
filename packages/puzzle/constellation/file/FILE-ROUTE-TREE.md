---
name: Shared route-flatten module
status: verified
path: client-runtime/router/routeTree.js
language: javascript
summary: The single source of the nested-routes → per-leaf flatten both the Router and the SSG prerenderer walk.
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# routeTree.js

The one implementation of the nested-routes → per-leaf flatten. The Router
(compiling each leaf into a matcher entry) and the SSG prerenderer (enumerating
pages to emit) must walk `children` by the **same** rules — same leaf set, same
composed paths — or a navigable route fails to prerender, or a prerendered page
never matches. It owns `joinPath` (an index child `''` composes to the parent
path; otherwise a single-`/` join with the parent's trailing slash trimmed) and
the depth-first per-leaf walk; each consumer keeps its own concerns (chain
validation + regex compilation vs. inherited-layout extraction) inside the
`makeLeaf` callback it passes in.

DOM-free and import-free, so it runs unchanged in the browser bundle and under
Node's prerender pass. `tests/route-tree-shared.test.js` has a drift guard
asserting SSG enumeration and the router table agree — never fork this logic
back into either consumer.
