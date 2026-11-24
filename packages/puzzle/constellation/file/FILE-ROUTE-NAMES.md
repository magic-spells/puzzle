---
name: routeNames.js — the route name table and named-target resolver
status: verified
path: client-runtime/router/routeNames.js
language: javascript
summary: >-
  Builds the route name → full path table and resolves a `{ name, params, query, hash }` target to
  the path string every router consumer already handles (D196).
connections:
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - FILE-ROUTE-TREE
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-RUNTIME
  - FILE-STATIC-MOUNT
  - DECISION-D196-NAMED-ROUTES
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# routeNames.js

- `routeNames(routes)` walks the route definitions and returns a `Map` of name → full path pattern (`null` for the top-level catch-all). A duplicate name throws in development and keeps the first in production. The Router calls it once in its constructor; the prerender calls it once per pass.
- `routeNamesJSON(table)` is the plain object a static page's names island carries (catch-all left out).
- `targetPath(target, names)` returns a string unchanged and resolves an object; anything else throws a `[puzzle]` error. `names` is always the `Map`: a static page rebuilds one from its `data-puzzle-static-names` island, which the prerender writes only when the page resolved a named link or is a `prerender: false` page.

DOM-free and imports only `routeTree.js` and `routePath.js`, so it runs in the browser bundle and under Node unchanged. Development-only checks (unknown keys, unused params, the list of named routes in an unknown-name error) sit behind `__PUZZLE_DEV__`.
