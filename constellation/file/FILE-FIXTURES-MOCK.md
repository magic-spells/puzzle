---
name: in-memory mock adapter
status: built
path: client-runtime/fixtures/mock.js
language: javascript
summary: >-
  Serves one adapter request from the merged mock config: Response-shaped result, default CRUD,
  handler, latency, failure.
connections:
  - COMPONENT-FIXTURES
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - COMPONENT-ADAPTER
---


Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/fixtures/mock.js`.
