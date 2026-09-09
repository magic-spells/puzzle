---
name: 0.2.0 — true static output
status: built
version: 0.2.0
connections:
  - RELEASE-V0-1-2
  - DECISION-D81-STATIC-PAGES-MODE
---

# 0.2.0 — true static output

Published 2026-07-24. The release is named for one rename. `output: 'static'`
had meant "prerendered pages plus the full SPA bundle plus router takeover";
that mode became `output: 'hybrid'`, byte-identical, which freed `'static'` to
mean what it says — per-route content-complete HTML with no router, no
`app.js`, and plain `<a>` page loads.

That rename is why this is a minor and not a patch. Caret ranges do not cross
0.x minors, and a config key that silently builds a different product is
exactly the case that protection exists for.

Around the rename sits the ergonomics round that stopped apps reaching into
framework internals: path-shaped links so a `#` never has to appear in app
code, inherited route guards, route head management, a router query snapshot,
and a dev server that survives a busy port. The `.pzl` section tags also went
singular.

## Upgrade notes

- **Rename `output: 'static'` to `output: 'hybrid'`.** This is the quietest
  break in the project's history: it is not a compile error and not a warning.
  The build succeeds and produces a different product.
- **Rename the `.pzl` section tags:** `<scripts>` → `<script>`, `<styles>` →
  `<style>`, including `<script lang="ts">` and `<style scoped>`.
