---
name: server adapter runtime
status: verified
path: client-runtime/datastore/adapter.js
language: javascript
summary: >-
  The opt-in server sync runtime published as ./adapter: the capability, the installed
  Store/PuzzleModel verbs, and PuzzleAdapterError.
connections:
  - COMPONENT-ADAPTER
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/datastore/adapter.js`.
