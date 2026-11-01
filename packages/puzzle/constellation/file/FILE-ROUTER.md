---
name: router runtime
status: verified
path: client-runtime/router/router.js
language: javascript
summary: Route compilation, guards, navigation, commit, transitions, scroll, and SSG takeover.
connections:
  - COMPONENT-ROUTER
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# router.js

The `Router` class: route compilation, guards, load-then-commit navigation, transitions, scroll, and SSG/hybrid takeover. Behavior lives on [[COMPONENT-ROUTER]].

- The nested-tree flatten is delegated to `routeTree.js` ([[FILE-ROUTE-TREE]]) and `router.views` plus the `agent` checks to `routeViews.js` ([[FILE-ROUTE-VIEWS]]).
- Route-path shape (`isDynamicSegment`, path canonicalization) lives in the sibling `routePath.js`, which `modes.js`, `ssg/assemble.js` and `ssg/index.js` also import, so the browser Router and the Node prerender agree on a path's spelling ([[DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP]]).
- It also exports pure URL helpers (`encodeURL`, `normalizeBase`, `localeBase`, `linkLocale`) that `ssg/assemble.js` and `ssg/index.js` import, so the module must stay importable under Node: no DOM access at module load.
- Development checks (`warnShadowedPaths`, `checkAgentRoutes`) run inside a `__PUZZLE_DEV__` block in the constructor so production drops them.
