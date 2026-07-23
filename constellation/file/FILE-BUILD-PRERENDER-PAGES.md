---
name: Go static-pages build step
status: verified
path: compiler/internal/build/prerender_pages.go
language: go
summary: True-static pipeline — per-page entry generation, slug/collision rules, app.js removal.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-SSG
  - DECISION-D80-STATIC-PAGES-MODE
verified_at: '2026-07-23T00:00:00.000Z'
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D80-STATIC-PAGES-MODE]]); this card anchors that plan to `compiler/internal/build/prerender_pages.go`. Generates one `dist/_puzzle/<slug>.js` mountStatic entry per written page (keyed on the codegen `__pzlModule` stamps), derives slugs + suffixes collisions, detects models/formatters modules and warns on app.js-only formatters, and drops `staging/app.js`.
