---
name: D8 — A flat, minimal `PuzzleApp` config; each key earns its own decision
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D66-APP-LIFECYCLE-HOOKS
---

# D8 — A flat, minimal `PuzzleApp` config

Enforced by [[DOC-SPEC-ANATOMY]] §2, which lists the current keys.

## Decision
- The `PuzzleApp` config is one **flat** object. The core is `{ target, routes, models, formatters, apiURL }`; every other key (`scrollBehavior`, `routerMode`, `routerBase`, `transitionMode`, `adapter`, `storage`, the app lifecycle hooks of [[DECISION-D66-APP-LIFECYCLE-HOOKS]], …) was added by its own decision and is passed through only when set.
- New surface goes in as a flat key with an imported value when it needs one (`routerMode: hashRouter()`), never as a nested options object.
- There is no app-level `computed`, `methods`, `settings` map or global `events` map: state lives in the store and in views.

## Alternatives rejected
- The prototype's kitchen-sink config (app-level settings, computed, global events with keyboard-shortcut strings, methods) — months of runtime work nothing needed.
- Nested groups (`router: { mode }`) — the surface is flat; [[DECISION-D34-HASH-ROUTING]] followed the `scrollBehavior` precedent.
