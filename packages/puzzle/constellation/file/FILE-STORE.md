---
name: reactive Store runtime
status: verified
path: client-runtime/datastore/store.js
language: javascript
summary: Record registry, query tracking, model registration guards, persistence, and batched delivery.
connections:
  - COMPONENT-STORE
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# datastore/store.js

The `Store` class ([[COMPONENT-STORE]]): the record registry, tracked queries inside `data()` (`withTracking`), two-level subscriptions (`type` and `type id`), batched notification delivery on the shared frame scheduler, persistence, `observe()` (D184) and `modelFor()` (D189).

- `_notify` stamps `RENDER_REV` ([[FILE-RENDER-REV]]) onto the record. The store never imports anything under `views/`.
- D161 fetch attribution is per subscriber handle (`HANDLE_CTX`): only reads made through a view's own `ctx.store` handle during its `data()` pass can queue a fetch; the raw store and every other reader get a local snapshot. Server sync itself lives in the opt-in `datastore/adapter.js`.
