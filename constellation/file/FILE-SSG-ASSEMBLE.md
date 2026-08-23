---
name: Shared chain assembly
status: verified
path: client-runtime/ssg/assemble.js
language: javascript
summary: assembleChain — DOM-free layout+view chain assembly shared by prerenderer and static kernel.
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
verified_at: '2026-08-23T19:55:42.458Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]]); this card anchors that plan to `client-runtime/ssg/assemble.js`. The single source of chain assembly for both the build-time prerenderer and the browser `mountStatic` kernel ([[DECISION-D81-STATIC-PAGES-MODE]]), so a prerendered page and its client render cannot diverge.
