---
name: Render profiling test assertion helper
status: verified
path: client-runtime/testing/render-profile.js
language: javascript
summary: Runner-neutral measureRenders helper backed by the dev performance event sink and settled()
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D94-TESTING-EXPORT
  - COMPONENT-TESTING
  - DOC-TESTING
  - FILE-DEVPERF
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Extends the D94 testing surface with the immutable render report defined by [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It reuses `settled()` and imports no test framework.
