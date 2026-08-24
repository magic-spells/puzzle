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
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the shared flatten rules. The Router (router.js, compiling
each leaf into a matcher Entry) and the SSG prerenderer (ssg/index.js,
enumerating the pages to emit) must walk the `children` tree by the SAME rules
— same leaf set, same composed paths — or a route the app can navigate to
would fail to prerender, or a prerendered page would never match. This module
owns those rules in exactly one place: `joinPath` (index child `''` composes
to the parent path; otherwise single-`/` join with the parent's trailing
slash trimmed) and the depth-first per-leaf walk, with each consumer keeping
its own concerns (chain validation + regex compilation vs. inherited-layout
extraction) inside the one `makeLeaf` callback it passes in.

DOM-free and imports nothing, so it runs unchanged in the browser bundle and
under Node's prerender pass — the same dual-context discipline as
`ssg/assemble.js`. It exists because the flatten logic previously lived twice
and the copies could drift silently (the same failure family as the
triplicated URL encoder the deep-review round consolidated).
