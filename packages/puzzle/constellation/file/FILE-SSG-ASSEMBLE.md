---
name: Shared chain assembly
status: verified
path: client-runtime/ssg/assemble.js
language: javascript
summary: >-
  DOM-free chain and nested component assembly shared by prerenderer and static kernel, including
  Component ranges.
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# ssg/assemble.js

The single chain assembly for both the build-time prerenderer (`ssg/index.js`) and the browser `mountStatic` kernel ([[FILE-STATIC-MOUNT]], [[DECISION-D81-STATIC-PAGES-MODE]]), so a prerendered page and its client render build the same nested ViewNode tree. `assembleChain` preloads each chain level (`created()` plus awaited `data()`, no DOM), builds the nested keyed component vnodes the way the Router's navigation does with each `.instance` pinned, and freezes the route snapshot. It also owns the static router facade: `makeRouterStub` (`url()` and a read-only `current`; every navigation method throws) and `localizeRouterStub` for D177 locale prefixes. The stub's `url()` resolves a named target through its `names` table and marks the stub `named`, which tells the prerender the page needs a names island ([[FILE-ROUTE-NAMES]]).

Must stay DOM-free: it imports only `ViewNode`, the Router's pure URL helpers, `routePath.js` and `routeNames.js`, because it runs under Node and in the browser.
