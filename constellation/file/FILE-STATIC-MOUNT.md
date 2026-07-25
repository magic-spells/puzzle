---
name: Static output kernel
status: verified
path: client-runtime/static/index.js
language: javascript
summary: mountStatic — the browser kernel that wakes a prerendered static page (no router).
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-SSG-ASSEMBLE
verified_at: '2026-07-25T00:10:00.000Z'
verified_sha: 87078756d4e8a665c4a582864fbe7273cbf6f286
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D81-STATIC-PAGES-MODE]]); this card anchors that plan to `client-runtime/static/index.js`.
