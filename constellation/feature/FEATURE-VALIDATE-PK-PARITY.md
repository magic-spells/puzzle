---
name: "validate() / createRecord pk parity"
status: verified
verified_at: '2026-07-22T09:00:00.000Z'
connections:
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D05-SCHEMA-BUILDERS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
notes:
  - kind: state
    text: >-
      Found by the habit-lab test app (2026-07-22): its create-habit form
      pre-checked input with Habit.validate() and silently dead-ended on a
      spurious "id is required" error the form couldn't render.
---

# validate() / createRecord pk parity

## Intent

`Model.validate(values)` must not reject input that `store.createRecord(type, values)`
would accept. Today the static checker is stricter than the write path it exists to
pre-check, which turns the documented "non-throwing pre-check → inline field errors"
form idiom into a footgun.

## The asymmetry

`.primary()` sets **both** `def.primary` and `def.required`
(`client-runtime/model.js:22-26`), and validation treats the pk like any other
required field. But the two entry points see different data:

- `store.createRecord` → `_instantiate` fills a missing pk **before** validating:
  `applyDefaults` at `store.js:224`, then `withDefaults[pk] = this._genId(map)` at
  `store.js:225`, and only then `_collectErrors` at `store.js:230`. A pk-less
  payload is fine — that is how checkin-style server-assigned-id models work.
- `Model.validate(data)` (`model.js:402-405`) → `_collectErrors(data)` raw: no
  defaults, no pk generation. A pk-less payload always fails
  `{field: "id", rule: "required"}`.

So a form that validates user input before `createRecord` gets an error for a field
the user cannot see or fix.

## Design

Smallest correct change: in `_collectErrors` (or in `fieldErrors`' required check,
`model.js:126-133`), when the field's `def.primary === true` and the value is
missing, **skip the required error** — the pk is auto-fillable by the store. The
`def.primary` flag is the exact hook that distinguishes "required because primary"
from "required because the author said so".

Second, additive improvement (optional, can ship separately): a public partial
validate, `Model.validate(data, { fields })`, forwarding to the existing
`_collectErrors(data, fields)` machinery that `update()` already uses
(`model.js:444-445`). This gives forms a sanctioned way to check only the fields
they edit.

### Why not "just apply defaults + a synthetic pk inside validate()"

Mutating/augmenting the caller's data inside a checker blurs its contract ("is this
input valid?" becomes "would some derived input be valid?"), and defaults belong to
record construction. Skipping the auto-generatable pk is honest: the input *is*
valid as an input to `createRecord`.

## Blast radius

- `save()`'s full-record check (`store.js:423` → `_collectErrors(record.toJSON())`)
  is unaffected in practice: any record in the store already has a pk (generated or
  supplied), so the skipped rule can never mask a real missing-pk on save.
- `record.validate()` (instance form) likewise operates on a constructed record.
- A model whose pk is genuinely user-supplied (e.g. slug-as-pk) loses the "required"
  pre-check on that field via static validate. If that matters, the author can add
  `.required('slug is required')` semantics via a `.validate(fn)` rule — or we keep
  `required` errors for pks whose builder chain called `.required()` explicitly
  *after* `.primary()`. Decide during implementation; default recommendation is the
  simple skip.

## Scope

**In:** the `def.primary` skip in the required check; unit tests; DOC-MODELS update
(document that validate() mirrors createRecord's acceptance).
**Out:** partial validate (`{ fields }`) — nice-to-have follow-up; any change to
`_genId` or pk adoption.

## Test plan

- `Model.validate({...valid, no pk})` → valid; with pk → valid; missing *other*
  required field → that error only.
- `createRecord` acceptance and `validate()` acceptance agree on a matrix of
  payloads (property-style parity test).
- Existing v1.16 validation suite stays green.
