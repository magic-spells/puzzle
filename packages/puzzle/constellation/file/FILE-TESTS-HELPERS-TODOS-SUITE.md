---
name: todos-suite.js
status: verified
path: tests/helpers/todos-suite.js
language: JavaScript
summary: 'runTodosSuite: the shared todos integration assertions, run against fixtures and compiler output.'
connections:
  - TEST-TODOS-INTEGRATION
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# todos-suite.js

`runTodosSuite({ TodoHome, DefaultLayout, Todo, label })`: the shared body of the todos integration suite ([[TEST-TODOS-INTEGRATION]]). It drives a real `PuzzleApp` with DOM events and asserts the DOM, once against the hand-written fixtures and once against compiler output, so a failure only in the compiled run is a codegen bug, not a test bug. Each calling test file must declare `// @vitest-environment jsdom` itself; the pragma is per file and cannot be imported.
