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
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Default.compiled.js

A hand-written stand-in for the compiler's output of the todos example's `Default.pzl` layout. `tests/todos-app.test.js` runs the shared todos suite against these hand-written fixtures and `tests/todos-app-compiled.test.js` runs it against real compiler output, so a failure only in the compiled run points at codegen ([[TEST-TODOS-INTEGRATION]]). Other runtime tests import the fixtures too; change them only alongside the runtime contract they model.
