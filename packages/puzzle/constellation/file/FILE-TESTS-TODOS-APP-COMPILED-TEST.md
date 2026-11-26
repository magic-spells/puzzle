---
name: todos-app-compiled.test.js
status: verified
path: tests/todos-app-compiled.test.js
language: JavaScript
summary: Todos integration suite against real compiler output for examples/todos.
connections:
  - TEST-TODOS-INTEGRATION
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# todos-app-compiled.test.js

Runs the shared todos suite against the compiler's real output for `examples/todos` (view and layout; the model is the hand-written fixture) — green means `puzzle build examples/todos` yields a working app ([[TEST-TODOS-INTEGRATION]]).

**Gotcha:** the compiled modules live in the gitignored `tests/fixtures/todos-compiled/`, written by `npm run build:example-modules`. `npm test` runs it in `pretest`; a bare `npx vitest run` does not, so on a fresh checkout, or after a codegen or example change, run `npm test` (or that script) first.
