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
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

Owns the runtime machinery for [[DECISION-D144-PORTAL]]. Import-holding call
sites remain in the app/static kernels and [[COMPONENT-VIEW-MANAGER]], guarded
by D89's full inline `__PUZZLE_HAS_PORTAL__` probe.
