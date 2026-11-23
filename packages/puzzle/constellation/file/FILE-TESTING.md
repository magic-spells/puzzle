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
verified_at: '2026-11-23T03:11:02.446Z'
verified_sha: f90f22201ff6b00245f353d5f5f90bb7634bb963
---

# testing/index.js

The published `@magic-spells/puzzle/testing` entry ([[DECISION-D94-TESTING-EXPORT]], [[COMPONENT-TESTING]]). `mountView` gives a direct-view test a full ctx (store, function registry, i18n) without booting a router; `createTestApp` boots a real `PuzzleApp` on `memoryRouter()` so guard → load → atomic commit runs as in production while the host URL stays untouched; `type()` simulates typing. It re-exports `settled`, `measureRenders`, `installFakeAnimate`, `installFakeObserver` and `installFixtures`.
