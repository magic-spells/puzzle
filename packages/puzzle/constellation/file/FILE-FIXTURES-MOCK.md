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
  - DECISION-D193-SERVER-QUERIES
verified_at: '2026-11-21T22:33:06.881Z'
verified_sha: c4c10f303caeac8050633ea434af17e4d3a75001
---

# fixtures/mock.js

The in-memory REST server behind a model's `static adapter = { mock }` or the
fixtures file's `mock` block ([[DECISION-D95-FIXTURES-MOCK-ADAPTER]]). It sits at
`Store._network`, so `loadOne`/`loadMany`/`save()`/`delete()`/`request()` run
unmodified — a mocked app exercises the real read and write paths
([[COMPONENT-ADAPTER]]).

- **Results are Response-shaped, not `Response`** (not uniformly available across
  Node/jsdom): exactly `ok`, `status`, `statusText`, `json()`, `text()`, plus
  `RESPONSE_BRAND` so the adapter's `isResponse()` accepts it — a brand, not a
  duck-type that user data could match.
- A collection GET carrying `page`, `limit` or `after` answers one page as
  `{ records, meta }` ([[DECISION-D193-SERVER-QUERIES]]); other query params are
  ignored.
- `latency` and `fail`/`failRate` exist because nothing else can make a skeleton
  show on localhost or a `data()` reject on purpose. Rolls use the mock's own seeded
  stream ([[FILE-FIXTURES-STATE]]).
