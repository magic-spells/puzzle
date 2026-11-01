---
name: PuzzleModel runtime
status: verified
path: client-runtime/model.js
language: javascript
summary: Model base class, schema builders, validation, relationships, and safe assignment.
connections:
  - COMPONENT-PUZZLE-MODEL
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# model.js

`PuzzleModel` and the `Puzzle.*` field builders ([[COMPONENT-PUZZLE-MODEL]]).
Records are instances of the user's model class, so getters and methods work
wherever a record is read.

- Validation enforces at the local write boundary: `createRecord`/`update` throw
  `PuzzleValidationError`; `validate()` returns `{ valid, errors }`.
- Identity is normalized at every index/comparison boundary, never on a record's
  fields (D112).
- Date classification goes only through `dates.js` ([[FILE-DATES]]) at every JSON
  boundary. Its only import is `dates.js`; it must stay DOM-free so the store and
  prerender can load it under Node.
