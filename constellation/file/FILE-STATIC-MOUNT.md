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
verified_at: '2026-08-16T04:33:32.402Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D81-STATIC-PAGES-MODE]]); this card anchors that plan to `client-runtime/static/index.js`.
