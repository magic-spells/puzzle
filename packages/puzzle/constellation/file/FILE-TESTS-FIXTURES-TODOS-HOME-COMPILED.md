---
name: Home.compiled.js
status: verified
path: tests/fixtures/todos/Home.compiled.js
language: JavaScript
summary: >-
  Hand-written stand-in for the compiled todos Home view, shared by the todos suite and other
  runtime tests.
connections:
  - TEST-TODOS-INTEGRATION
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Home.compiled.js

A hand-written stand-in for the compiler's output of the todos example's `Home.pzl` view, used by the fixture half of the todos suite ([[TEST-TODOS-INTEGRATION]]) and by other runtime tests (list counters, component prop bailout, `./testing`). The compiled half uses real `pzlc` output instead, so this file models the runtime contract, not codegen byte for byte.
