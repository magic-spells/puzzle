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
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# ssg/assemble.js

The single chain assembly for both the build-time prerenderer (`ssg/index.js`) and the browser `mountStatic` kernel ([[FILE-STATIC-MOUNT]], [[DECISION-D81-STATIC-PAGES-MODE]]), so a prerendered page and its client render build the same nested ViewNode tree. `assembleChain` preloads each chain level (`created()` plus awaited `data()`, no DOM), builds the nested keyed component vnodes the way the Router's navigation does with each `.instance` pinned, and freezes the route snapshot. It also owns the static router facade: `makeRouterStub` (`url()` and a read-only `current`; every navigation method throws) and `localizeRouterStub` for D177 locale prefixes.

Must stay DOM-free: it imports only `ViewNode`, the Router's pure URL helpers and `routePath.js`, because it runs under Node and in the browser.
