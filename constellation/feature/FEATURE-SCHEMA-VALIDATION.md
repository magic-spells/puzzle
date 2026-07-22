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
verified_at: '2026-07-12T00:14:41.892Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: implementation reviewed line-by-line against SPEC §20 at
      ship, tests/validation.test.js (27) + full suite green (480 vitest).
---

# v1.16 — Schema validation enforcement

The rules stored by the [[DECISION-D05-SCHEMA-BUILDERS]] builders since v1
(`required`, `min`, `max`, `oneOf`, `validate`) now enforce. Driven by
[[DECISION-D48-SCHEMA-VALIDATION]]; contract in [[DOC-SPEC]] §20.

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
- **Renderable surface:** static `Model.validate(data)` + instance
  `record.validate()` return `{ valid, errors }` without throwing.
- **Exempt paths:** `loadAll`/`loadOne` upserts (server authoritative) and
  storage hydration (fail-soft startup) skip validation.
- Rule semantics per §20: required-first short-circuit, null/undefined skip for
  non-required fields, length vs value bounds, strict `oneOf`, falsy-return
  custom rules (thrown validator exceptions propagate), no type coercion.

**Out (rejected in D48):** persistent `record.errors` state, opt-in/bypass
flags, async validators, cross-record validation, type checking.

## Outcome

Shipped in v1.16. Runtime-only — model.js (rule engine + error class +
validate surfaces), store.js (`_instantiate` validate flag), index.js export;
`tests/validation.test.js` (27 tests); [[DOC-MODELS]]/[[DOC-DATASTORE]]
updated. Full suite green (392 vitest). Foundation for
[[FEATURE-ADAPTER-WRITE-SYNC]]'s validate-before-sync.
