---
name: async work tracking and settled()
status: verified
path: client-runtime/testing/settled.js
language: javascript
summary: Framework work instrumentation and the fixed-point settled() drain behind every testing helper.
connections:
  - COMPONENT-TESTING
  - DECISION-D94-TESTING-EXPORT
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# testing/settled.js

The async-work tracking behind every `./testing` helper and the fixed-point `settled()` drain ([[DECISION-D94-TESTING-EXPORT]]). `PuzzleView` keeps its last-wins `data()` token private and store notifications do not return promises, so on first use `ensureTracking()` wraps `PuzzleView.prototype` `refresh`/`setData`/`destroy` and `registerStore`/`registerRouter` instrument those services; `settled()` then loops until no tracked work remains (bounded by `maxPasses`).

Production runtime code never imports this module, so app behavior and bundle size are untouched. `destroy` clears a view's pending work so an abandoned, never-resolving `data()` cannot hold `settled()` open.
