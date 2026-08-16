---
name: Render profiling test assertion helper
status: verified
path: client-runtime/testing/render-profile.js
language: javascript
summary: Runner-neutral measureRenders helper backed by the dev performance event sink and settled()
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - DECISION-D94-TESTING-EXPORT
  - DOC-TESTING
  - FILE-DEVPERF
verified_at: '2026-08-16T04:34:55.662Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Extends the D94 testing surface with the immutable render report defined by [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It reuses `settled()` and imports no test framework.
