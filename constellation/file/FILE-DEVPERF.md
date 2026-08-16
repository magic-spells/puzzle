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
verified_at: '2026-08-16T04:34:54.845Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Implements [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It owns all per-view profiler state in WeakMaps and is reachable from the application runtime only through foldable positive `__PUZZLE_DEV__` call-site guards.
