---
name: 'D1 — Client-rendered runtime: no SSR server, no hydration protocol'
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-APP
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D1 — Client-rendered runtime: no SSR server, no hydration protocol

Keeps the runtime small, the mental model simple, and compiler output free of server concerns.

## Decision
- Puzzle renders on the client only: no request-time server rendering and no hydration protocol.
- Build-time prerendering is allowed, in two modes that render pages in Node at build time:
  - `output: 'hybrid'` ([[DECISION-D67-HYBRID-PRERENDER]]) — the SPA runtime takes the prerendered page over at navigation zero with its normal code path.
  - `output: 'static'` ([[DECISION-D81-STATIC-PAGES-MODE]]) — true static pages with a per-page `mountStatic` module; no router, no `app.js`.

## Alternatives rejected
- Request-time SSR / universal rendering — a server runtime and a second render path for a small framework.
- DOM-adoption hydration — replace-on-commit takeover is flash-free because the markup is identical.
