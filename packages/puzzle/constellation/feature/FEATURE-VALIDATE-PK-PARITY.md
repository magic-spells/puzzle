---
name: "validate() / createRecord pk parity"
status: verified
verified_at: '2026-11-01T19:19:25.478Z'
connections:
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D05-SCHEMA-BUILDERS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
  - DOC-SPEC-DATA
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
change: fix
---

# validate() / createRecord pk parity

`Model.validate(values)` must not reject input `store.createRecord(type, values)`
would accept; otherwise the "non-throwing pre-check → inline field errors" form
idiom dead-ends on an `id is required` error the user cannot see or fix.
Contract: [[DOC-SPEC-DATA]] §20, [[DECISION-D48-SCHEMA-VALIDATION]].

## The rule

- `.primary()` sets `required`, but `createRecord` fills a nullish pk **before**
  validating (server-assigned-id models rely on this). So a nullish primary key
  the store would auto-generate is **exempt from the required error — and only
  that**. `''` still fails: the store only generates for `null`/`undefined`.
- `.required()` sets a separate `explicitRequired` flag. An explicit-required pk
  (`slug: string().primary().required()`) reports the required error normally.
- Both sides honor that flag (`model.js` + `store.js _instantiate`, which cite
  this card): with validation on (`createRecord`), an explicit-required pk is
  **not** auto-generated, so D48 throws exactly as `validate()` reports. With
  validation off (storage hydration, server upserts) it still auto-generates —
  those paths are fail-soft and must not crash on a missing key. The fixtures
  generator fills such a pk for the same reason.
- Static `validate` applies schema `.default()`s before collecting errors (it
  mirrors what `createRecord` will do), but never invents a pk.
  `Model.validate(data, { fields })` checks only the listed fields.

Rejected: synthesizing a pk inside `validate()` — a checker must answer "is this
input valid?", not "would some derived input be valid?".

`save()` and `record.validate()` are unaffected: a stored record always has a pk.
Pinned by the "createRecord primary-key parity" group in `tests/validation.test.js`.
