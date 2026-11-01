---
name: router-overlap.test.js
status: verified
path: tests/router-overlap.test.js
language: JavaScript
summary: Overlap route-transition suite for D56.
connections:
  - DECISION-D56-OVERLAP-TRANSITIONS
  - TEST-TRANSITIONS-MORPH
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# router-overlap.test.js

The overlap transition-mode suite ([[DECISION-D56-OVERLAP-TRANSITIONS]]): the incoming view mounts and commits while the outgoing one still fades. It also covers hook order in the overlap window, interruption, a failed navigation mid-overlap, reused layouts, the sequential default staying unchanged, and per-route/per-view `transitionMode` (D65). Behavioral detail lives on [[TEST-TRANSITIONS-MORPH]].
