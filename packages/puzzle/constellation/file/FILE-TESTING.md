---
name: testing module entry
status: verified
path: client-runtime/testing/index.js
language: javascript
summary: >-
  Published ./testing entry: mountView, createTestApp, type(), the mounted handles, and the
  re-exports.
connections:
  - COMPONENT-TESTING
  - DECISION-D94-TESTING-EXPORT
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# testing/index.js

The published `@magic-spells/puzzle/testing` entry ([[DECISION-D94-TESTING-EXPORT]], [[COMPONENT-TESTING]]). `mountView` gives a direct-view test a full ctx (store, function registry, i18n) without booting a router; `createTestApp` boots a real `PuzzleApp` on `memoryRouter()` so guard → load → atomic commit runs as in production while the host URL stays untouched; `type()` simulates typing. It re-exports `settled`, `measureRenders`, `installFakeAnimate`, `installFakeObserver` and `installFixtures`.
