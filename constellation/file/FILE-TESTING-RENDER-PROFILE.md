---
name: Render profiling test assertion helper
status: built
path: client-runtime/testing/render-profile.js
language: javascript
summary: Runner-neutral measureRenders helper backed by the dev performance event sink and settled()
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - DECISION-D94-TESTING-EXPORT
  - DOC-TESTING
  - FILE-DEVPERF
---

Extends the D94 testing surface with the immutable render report defined by [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]. It reuses `settled()` and imports no test framework.
