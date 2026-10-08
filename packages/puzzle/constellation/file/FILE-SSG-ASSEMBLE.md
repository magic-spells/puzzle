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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]]); this card anchors that plan to `client-runtime/ssg/assemble.js`. The single source of chain assembly for both the build-time prerenderer and the browser `mountStatic` kernel ([[DECISION-D81-STATIC-PAGES-MODE]]), so a prerendered page and its client render cannot diverge.
