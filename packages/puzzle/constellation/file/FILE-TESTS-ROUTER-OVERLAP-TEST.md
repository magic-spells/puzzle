---
name: router-overlap.test.js
status: verified
path: tests/router-overlap.test.js
language: JavaScript
summary: Overlap route-transition suite for D56.
connections:
  - DECISION-D56-OVERLAP-TRANSITIONS
  - TEST-TRANSITIONS-MORPH
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# router-overlap.test.js

The overlap transition-mode suite ([[DECISION-D56-OVERLAP-TRANSITIONS]]): the incoming view mounts and commits while the outgoing one still fades. It also covers hook order in the overlap window, interruption, a failed navigation mid-overlap, reused layouts, the sequential default staying unchanged, and per-route/per-view `transitionMode` (D65). Behavioral detail lives on [[TEST-TRANSITIONS-MORPH]].
