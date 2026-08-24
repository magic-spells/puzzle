---
name: router-overlap.test.js
status: verified
path: tests/router-overlap.test.js
language: JavaScript
summary: Load-bearing file for FEATURE-OVERLAPPING-TRANSITIONS.
connections:
  - FEATURE-OVERLAPPING-TRANSITIONS
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# router-overlap.test.js

Source binding for [[FEATURE-OVERLAPPING-TRANSITIONS]]. The path is the contract; keep behavioral detail on the owning card.
