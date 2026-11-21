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
verified_at: '2026-11-21T22:33:06.881Z'
verified_sha: c4c10f303caeac8050633ea434af17e4d3a75001
---

# testing/index.js

The published `@magic-spells/puzzle/testing` entry ([[DECISION-D94-TESTING-EXPORT]], [[COMPONENT-TESTING]]). `mountView` gives a direct-view test a full ctx (store, function registry, i18n) without booting a router; `createTestApp` boots a real `PuzzleApp` on `memoryRouter()` so guard → load → atomic commit runs as in production while the host URL stays untouched; `type()` simulates typing. It re-exports `settled`, `measureRenders`, `installFakeAnimate`, `installFakeObserver` and `installFixtures`.
