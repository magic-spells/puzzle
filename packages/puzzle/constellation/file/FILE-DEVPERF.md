---
name: Dev performance collector
status: verified
path: client-runtime/devperf.js
language: javascript
summary: Development-only performance events, causal chains, mutation accounting, and loop protection
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
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

Implements [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It owns all per-view profiler state in WeakMaps and is reachable from the application runtime only through foldable positive `__PUZZLE_DEV__` call-site guards.
