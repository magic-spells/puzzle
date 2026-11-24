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
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# testing/render-profile.js

`measureRenders(callback)` or `measureRenders(handle, callback)`: the runner-neutral render report from [[DECISION-D121-DEV-PERFORMANCE-PROFILING]], exported through `./testing` ([[DECISION-D94-TESTING-EXPORT]]). It installs the global devperf sink, runs the callback, drains with `settled()`, and returns an immutable report. The handle is never inspected — the sink is global — it only documents the call site. Imports no test framework.
