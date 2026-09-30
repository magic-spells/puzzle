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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Owns the runtime machinery for [[DECISION-D144-PORTAL]]. Import-holding call
sites remain in the app/static kernels and [[COMPONENT-VIEW-MANAGER]], guarded
by D89's full inline `__PUZZLE_HAS_PORTAL__` probe.
