---
name: in-memory mock adapter
status: verified
path: client-runtime/fixtures/mock.js
language: javascript
summary: >-
  Serves one adapter request from the merged mock config: Response-shaped result, default CRUD,
  handler, latency, failure.
connections:
  - COMPONENT-FIXTURES
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - COMPONENT-ADAPTER
verified_at: '2026-08-23T19:55:40.448Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/fixtures/mock.js`.
