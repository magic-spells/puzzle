---
name: PuzzleModel runtime
status: verified
path: client-runtime/model.js
language: javascript
summary: Model base class, schema builders, validation, relationships, and safe assignment.
connections:
  - COMPONENT-PUZZLE-MODEL
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
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
