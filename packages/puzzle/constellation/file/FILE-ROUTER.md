---
name: router runtime
status: verified
path: client-runtime/router/router.js
language: javascript
summary: Route compilation, guards, navigation, commit, transitions, scroll, and SSG takeover.
connections:
  - COMPONENT-ROUTER
  - FILE-ROUTE-NAMES
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# router.js

The `Router` class: route compilation, guards, load-then-commit navigation, transitions, scroll, and SSG/hybrid takeover. Behavior lives on [[COMPONENT-ROUTER]].

- The nested-tree flatten is delegated to `routeTree.js` ([[FILE-ROUTE-TREE]]) and `router.views` plus the `agent` checks to `routeViews.js` ([[FILE-ROUTE-VIEWS]]). Named targets (`{ name, params }`) are resolved to a path by `routeNames.js` ([[FILE-ROUTE-NAMES]], D196) at the top of `url()`, `push()`, `replace()`, `prefetch()` and a guard's redirect verdict.
- Link prefetch ([[DECISION-D195-LINK-PREFETCH]]) lives in the sibling `prefetch.js`, imported behind the `__PUZZLE_HAS_LAZY__` probe so an app without `lazy()` drops it; the router hands it `#linkPath` and its own `#prefetch(path, explicit)` loader, and `router.prefetch(target)` (a path or a named target) is the public form ([[COMPONENT-ROUTER]] owns the rules).
- Route-path shape (`isDynamicSegment`, path canonicalization) lives in the sibling `routePath.js`, which `modes.js`, `ssg/assemble.js` and `ssg/index.js` also import, so the browser Router and the Node prerender agree on a path's spelling ([[DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP]]).
- It also exports pure URL helpers (`encodeURL`, `normalizeBase`, `localeBase`, `linkLocale`, `pathLocale`) that `ssg/assemble.js`, `ssg/index.js`, `static/index.js` and `i18n.js` import. So the module must stay importable under Node (no DOM access at module load) and must have no module-level side effects: a class static block, for example, would keep the whole `Router` in every `output: 'static'` bundle.
- Development checks (`warnShadowedPaths`, `checkAgentRoutes`) run inside a `__PUZZLE_DEV__` block in the constructor so production drops them.
