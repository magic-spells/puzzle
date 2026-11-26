---
name: schema-driven fixture generator
status: verified
path: client-runtime/fixtures/generator.js
language: javascript
summary: Seeded PRNG plus the schema-to-value generation that backs store.seed().
connections:
  - COMPONENT-FIXTURES
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# fixtures/generator.js

The data half of `store.seed()` ([[COMPONENT-FIXTURES]]): generates records from
the model's own schema builders, so no second shape declaration exists anywhere.

- **Determinism is the contract.** Values come from a seeded mulberry32 stream kept
  per store ([[FILE-FIXTURES-STATE]]); nothing reads `Math.random()` or the clock.
  The one exception: an omitted primary key goes to the store's random `_genId` —
  pass explicit ids when a test needs them stable.
- Records go through the normal `createRecord` path, so schema defaults and pk
  assignment match production.
