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
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Owns the runtime machinery for [[DECISION-D144-PORTAL]]. Import-holding call
sites remain in the app/static kernels and [[COMPONENT-VIEW-MANAGER]], guarded
by D89's full inline `__PUZZLE_HAS_PORTAL__` probe.
