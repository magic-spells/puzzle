---
name: reactive Store runtime
status: verified
path: client-runtime/datastore/store.js
language: javascript
summary: Record registry, query tracking, model registration guards, persistence, and batched delivery.
connections:
  - COMPONENT-STORE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/datastore/store.js`.
