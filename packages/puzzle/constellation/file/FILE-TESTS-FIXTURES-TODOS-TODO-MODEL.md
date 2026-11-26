---
name: todo.model.js
status: verified
path: tests/fixtures/todos/todo.model.js
language: JavaScript
summary: The todos Todo model both halves of the todos suite share.
connections:
  - TEST-TODOS-INTEGRATION
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# todo.model.js

The todos `Todo` model. Both halves of the todos suite use it — the compiled half swaps in compiler output for the UI only — so a model change here moves both runs ([[TEST-TODOS-INTEGRATION]]).
