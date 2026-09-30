---
name: 0.2.0 — true static output
status: built
version: 0.2.0
connections:
  - RELEASE-V0-1-2
  - DECISION-D81-STATIC-PAGES-MODE
---

# 0.2.0 — true static output

Published 2026-07-24. `output: 'static'` now means true static pages (no
router, no `app.js`); the old prerendered-SPA mode is `output: 'hybrid'`
([[DECISION-D81-STATIC-PAGES-MODE]]). Also path-shaped links, route guards,
route head management, the router query snapshot, and the dev-server port scan.

## Upgrade notes

- Rename `output: 'static'` to `output: 'hybrid'` to keep the old product. The
  old spelling builds without error or warning — it just builds static pages.
- `.pzl` section tags are singular: `<script>`, `<style>`.
