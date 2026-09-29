---
name: Dev performance collector
status: verified
path: client-runtime/devperf.js
language: javascript
summary: Development-only performance events, causal chains, mutation accounting, and loop protection
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - DOC-SPEC-BUILD
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Implements [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It owns all per-view profiler state in WeakMaps and is reachable from the application runtime only through foldable positive `__PUZZLE_DEV__` call-site guards.
