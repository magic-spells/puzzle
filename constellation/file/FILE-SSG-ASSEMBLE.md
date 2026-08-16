---
name: Shared chain assembly
status: verified
path: client-runtime/ssg/assemble.js
language: javascript
summary: assembleChain — DOM-free layout+view chain assembly shared by prerenderer and static kernel.
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
verified_at: '2026-08-16T04:33:31.517Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]]); this card anchors that plan to `client-runtime/ssg/assemble.js`. The single source of chain assembly for both the build-time prerenderer and the browser `mountStatic` kernel ([[DECISION-D81-STATIC-PAGES-MODE]]), so a prerendered page and its client render cannot diverge.
