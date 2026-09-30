---
name: router-overlap.test.js
status: verified
path: tests/router-overlap.test.js
language: JavaScript
summary: Overlap route-transition suite for D56.
connections:
  - DECISION-D56-OVERLAP-TRANSITIONS
  - TEST-TRANSITIONS-MORPH
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# router-overlap.test.js

The overlap transition-mode suite ([[DECISION-D56-OVERLAP-TRANSITIONS]]): the
incoming view mounts and commits while the outgoing still fades. Behavioral
detail lives on [[TEST-TRANSITIONS-MORPH]].
