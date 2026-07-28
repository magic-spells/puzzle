---
name: Dev performance collector
status: built
path: client-runtime/devperf.js
language: javascript
summary: Development-only performance events, causal chains, mutation accounting, and loop protection
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
---

Implements [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It owns all per-view profiler state in WeakMaps and is reachable from the application runtime only through foldable positive `__PUZZLE_DEV__` call-site guards.
