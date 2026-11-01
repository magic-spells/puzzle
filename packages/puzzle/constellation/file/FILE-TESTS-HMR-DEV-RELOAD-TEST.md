---
name: hmr-dev-reload.test.js
status: verified
path: tests/hmr-dev-reload.test.js
language: JavaScript
summary: HMR snapshot/restore suite for D57.
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - TEST-DEV-RUNTIME-TOOLING
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# hmr-dev-reload.test.js

The HMR state-transfer suite ([[DECISION-D57-HMR-STATE-RELOAD]]): snapshot and restore across a dev reload, the two-phase restore, the `safeState` filter, and preserved D161 adapter read state. Behavioral detail lives on [[TEST-DEV-RUNTIME-TOOLING]].
