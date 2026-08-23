---
name: Portal runtime
status: verified
path: client-runtime/views/portal.js
language: javascript
summary: Usage-gated Portal outlet, range, teardown, and logical-containment runtime.
connections:
  - COMPONENT-VIEW-MANAGER
  - DECISION-D144-PORTAL
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
verified_at: '2026-08-16T04:32:59.292Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Owns the runtime machinery for [[DECISION-D144-PORTAL]]. Import-holding call
sites remain in the app/static kernels and [[COMPONENT-VIEW-MANAGER]], guarded
by D89's full inline `__PUZZLE_HAS_PORTAL__` probe.
