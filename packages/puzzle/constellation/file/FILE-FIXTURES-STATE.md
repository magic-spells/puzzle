---
name: per-store fixture state
status: verified
path: client-runtime/fixtures/state.js
language: javascript
summary: >-
  WeakMap-held per-Store fixture bookkeeping: the two seeded streams, the record counter, and the
  mock collections.
connections:
  - COMPONENT-FIXTURES
  - DECISION-D98-FIXTURES-MODULE-FLAG
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# fixtures/state.js

Per-store fixture bookkeeping in a WeakMap keyed by store
([[DECISION-D98-FIXTURES-MODULE-FLAG]]): zero footprint on the core `Store`, and
entries die with their stores. Internal to `fixtures/`.

- **One seed, two streams.** Value generation and the mock's latency/failure
  rolls never share a stream, or adding a `seed()` call would change which
  requests fail; both derive from the one seed so a run replays from one number.
- **State is created lazily** with the seed active at first use, so a later
  `installFixtures({ seed })` cannot retroactively reseed a store that already
  generated something.
