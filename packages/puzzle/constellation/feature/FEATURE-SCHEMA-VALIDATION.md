---
name: "v1.16 — Schema validation enforcement"
status: verified
connections:
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D05-SCHEMA-BUILDERS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
  - DOC-SPEC-DATA
  - FEATURE-ADAPTER-WRITE-SYNC
verified_at: '2026-08-16T04:34:07.996Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: implementation reviewed line-by-line against SPEC §20 at
      ship, tests/validation.test.js (27) + full suite green (480 vitest).
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
release: RELEASE-V0-1-0
change: feature
---

# v1.16 — Schema validation enforcement

The rules stored by the [[DECISION-D05-SCHEMA-BUILDERS]] builders since v1
(`required`, `min`, `max`, `oneOf`, `validate`) now enforce. Driven by
[[DECISION-D48-SCHEMA-VALIDATION]]; contract in [[DOC-SPEC-DATA]] §20.

## Intent

Invalid data is caught at a defined boundary with a defined error shape instead
of flowing silently into the store — the activation [[DOC-MODELS]] promised
("declare your rules now; they become active when enforcement lands").

## Scope

**In (shipped):**
- **Throwing boundary:** `store.createRecord` (validates after defaults + pk
  generation; on failure nothing inserted/notified/persisted) and
  `record.update` (patched fields only; record untouched on failure; works
  store-less) throw `PuzzleValidationError` — `.errors` =
  `[{ field, rule, message }]` in schema order, exported from the package root.
- **Renderable surface:** static `Model.validate(data, { fields }?)` + instance
  `record.validate()` return `{ valid, errors }` without throwing. Static
  validate applies schema `.default()`s first, so it accepts exactly what
  `createRecord` would; the auto-generatable primary key is exempt from the
  required error under the parity rule (FEATURE-VALIDATE-PK-PARITY).
- **Exempt paths:** `loadMany`/`loadOne` upserts (server authoritative) and
  storage hydration (fail-soft startup) skip validation.
- Rule semantics per §20: required-first short-circuit, null/undefined skip for
  non-required fields, length bounds for strings/arrays and value bounds for
  numbers/dates, strict `oneOf`, falsy-return custom rules (thrown validator
  exceptions propagate), no type coercion. Bounds are type-aware: a field
  *declared* `number()`/`date()` holding a wrong-runtime-type value (a
  form-bound `"150"`) reports a type mismatch rather than having its `.length`
  measured; `NaN` and invalid `Date` stay incomparable passes.

**Out (rejected in D48):** persistent `record.errors` state, opt-in/bypass
flags, async validators, cross-record validation, type checking.

## Outcome



Shipped in v1.16. Runtime-only — model.js (rule engine + error class +
validate surfaces), store.js (`_instantiate` validate flag), index.js export;
covered by `tests/validation.test.js`; [[DOC-MODELS]]/[[DOC-DATASTORE]]
carry the authoring contract. Foundation for
[[FEATURE-ADAPTER-WRITE-SYNC]]'s validate-before-sync.
