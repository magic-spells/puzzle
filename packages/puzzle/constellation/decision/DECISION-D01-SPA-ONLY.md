---
name: 'D1 — Client-rendered runtime: no SSR server, no hydration protocol'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-APP
---

# D1 — Client-rendered runtime: no SSR server, no hydration protocol

## Decision
Puzzle's runtime renders on the client only: no request-time server rendering and no hydration protocol. Build-time prerendering is allowed — static output ([[DECISION-D67-SSG-STATIC-BUILD]]) renders pages in Node at build time, and the SPA runtime takes the page over on load with one code path.

## Why
It keeps the runtime small, the mental model simple, and compiler output free of server concerns.

## Alternatives rejected
- Request-time SSR / universal rendering — a server runtime and a second render path for a small framework.
- DOM-adoption hydration — replace-on-commit takeover is flash-free because the markup is identical (D67).
