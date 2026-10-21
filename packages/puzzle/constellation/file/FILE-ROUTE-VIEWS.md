---
name: routeViews.js — router.views and agent checks
status: built
path: client-runtime/router/routeViews.js
language: javascript
summary: >-
  Builds the frozen router.views list from compiled leaf entries and runs the dev-only agent-field
  checks (D183).
connections:
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DECISION-D183-ROUTE-VIEWS-AGENT-FIELD
  - FEATURE-ROUTE-VIEWS-AGENT
---

# routeViews.js

`routeViews(entries)` projects the Router's compiled leaf entries into the public `router.views` records; the Router caches the result per instance. `checkAgentRoutes(entries, catchAll)` holds the development checks for the `agent` field.

The checks are module functions on purpose: the only call sits in the Router constructor's `__PUZZLE_DEV__` block, so production DCE drops the call and then the functions and their warn-once set. As a Router `#method` they would ship. The warn-once set is per module, so the SSG pass's several routers print each warning once; tests that assert a warning need distinct paths per test.
