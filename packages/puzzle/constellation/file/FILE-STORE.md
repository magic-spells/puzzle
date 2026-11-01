---
name: reactive Store runtime
status: verified
path: client-runtime/datastore/store.js
language: javascript
summary: Record registry, query tracking, model registration guards, persistence, and batched delivery.
connections:
  - COMPONENT-STORE
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# datastore/store.js

The `Store` class ([[COMPONENT-STORE]]): the record registry, tracked queries inside `data()` (`withTracking`), two-level subscriptions (`type` and `type id`), batched notification delivery on the shared frame scheduler, persistence, `observe()` (D184) and `modelFor()` (D189).

- `_notify` stamps `RENDER_REV` ([[FILE-RENDER-REV]]) onto the record. The store never imports anything under `views/`.
- D161 fetch attribution is per subscriber handle (`HANDLE_CTX`): only reads made through a view's own `ctx.store` handle during its `data()` pass can queue a fetch; the raw store and every other reader get a local snapshot. Server sync itself lives in the opt-in `datastore/adapter.js`.
