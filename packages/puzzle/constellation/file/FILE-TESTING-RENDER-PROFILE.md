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
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# testing/render-profile.js

`measureRenders(callback)` or `measureRenders(handle, callback)`: the runner-neutral render report from [[DECISION-D121-DEV-PERFORMANCE-PROFILING]], exported through `./testing` ([[DECISION-D94-TESTING-EXPORT]]). It installs the global devperf sink, runs the callback, drains with `settled()`, and returns an immutable report. The handle is never inspected — the sink is global — it only documents the call site. Imports no test framework.
