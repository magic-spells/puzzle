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
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# Home.compiled.js

A hand-written stand-in for the compiler's output of the todos example's `Home.pzl` view, used by the fixture half of the todos suite ([[TEST-TODOS-INTEGRATION]]) and by other runtime tests (list counters, component prop bailout, `./testing`). The compiled half uses real `pzlc` output. `TestGoldenHome` holds this file to the compiler's output of the same view, ignoring comments, blank lines and import specifiers, so a change to Home's codegen means editing this file too.
