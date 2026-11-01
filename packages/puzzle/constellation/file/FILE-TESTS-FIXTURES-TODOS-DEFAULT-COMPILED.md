---
name: Default.compiled.js
status: verified
path: tests/fixtures/todos/Default.compiled.js
language: JavaScript
summary: >-
  Hand-written stand-in for the compiled todos Default layout, used by the fixture half of the todos
  suite.
connections:
  - TEST-TODOS-INTEGRATION
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Default.compiled.js

A hand-written stand-in for the compiler's output of the todos example's `Default.pzl` layout. `tests/todos-app.test.js` runs the shared todos suite against these hand-written fixtures and `tests/todos-app-compiled.test.js` runs it against real compiler output, so a failure only in the compiled run points at codegen ([[TEST-TODOS-INTEGRATION]]). Other runtime tests import the fixtures too; change them only alongside the runtime contract they model.
