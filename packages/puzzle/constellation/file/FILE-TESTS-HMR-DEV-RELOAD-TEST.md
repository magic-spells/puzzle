---
name: hmr-dev-reload.test.js
status: verified
path: tests/hmr-dev-reload.test.js
language: JavaScript
summary: HMR snapshot/restore suite for D57.
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - TEST-DEV-RUNTIME-TOOLING
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# hmr-dev-reload.test.js

The HMR state-transfer suite ([[DECISION-D57-HMR-STATE-RELOAD]]): snapshot and restore across a dev reload, the two-phase restore, the `safeState` filter, and preserved D161 adapter read state. Behavioral detail lives on [[TEST-DEV-RUNTIME-TOOLING]].
