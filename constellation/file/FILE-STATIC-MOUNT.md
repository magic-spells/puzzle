---
name: Static output kernel
status: verified
path: client-runtime/static/index.js
language: javascript
summary: mountStatic — the browser kernel that wakes a prerendered static page (no router).
connections:
  - COMPONENT-SSG
  - DECISION-D79-STATIC-PAGES-MODE
  - FILE-SSG-ASSEMBLE
verified_at: '2026-07-23T00:00:00.000Z'
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D79-STATIC-PAGES-MODE]]); this card anchors that plan to `client-runtime/static/index.js`.
