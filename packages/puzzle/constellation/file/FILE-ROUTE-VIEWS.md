---
name: routeViews.js — router.views and agent checks
status: verified
path: client-runtime/router/routeViews.js
language: javascript
summary: >-
  Builds the frozen router.views list from compiled leaf entries and runs the dev-only agent-field
  checks (D183).
connections:
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DECISION-D183-ROUTE-VIEWS-AGENT-FIELD
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# routeViews.js

`routeViews(entries)` projects the Router's compiled leaf entries into the frozen `router.views` records (declaration order, catch-all left out); the Router builds it once per instance, on first read. `checkAgentRoutes(entries, catchAll)` holds the development checks for the `agent` field: a bad value throws, a name claimed by two different objects warns, and once any route declares `agent`, undescribed leaves warn.

- **Module functions on purpose.** The only call sits in the Router constructor's `__PUZZLE_DEV__` block, so production DCE drops the call and then the functions and their warn-once state. As a Router `#method` they would ship.
- **Warn-once state is per module**, so the SSG pass's several routers print each warning once. Tests that assert a warning need distinct paths per test.
