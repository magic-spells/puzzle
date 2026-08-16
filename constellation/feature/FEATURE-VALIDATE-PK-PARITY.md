---
name: "validate() / createRecord pk parity"
status: verified
verified_at: '2026-08-16T04:33:32.121Z'
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
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
release: RELEASE-V0-1-2
change: fix
---

# validate() / createRecord pk parity

## Intent

`Model.validate(values)` must not reject input that
`store.createRecord(type, values)` would accept. A static checker stricter than
the write path it exists to pre-check turns the documented "non-throwing
pre-check → inline field errors" form idiom into a footgun: the form dead-ends
on an `id is required` error for a field the user cannot see or fix.

## The two required-nesses

`.primary()` sets both `def.primary` and `def.required`, so without further
distinction the pk looks like any other required field. But the entry points
see different data:

- `store.createRecord` → `_instantiate` applies defaults and fills a missing pk
  **before** validating, so a pk-less payload is fine — that is how
  server-assigned-id models work.
- `Model.validate(data)` collects errors over the caller's data, which for a
  create form has no pk yet.

The parity rule is therefore: **a nullish primary key the store would
auto-generate is exempt from the required error, and only that.** `''` still
fails, because the Store only auto-generates for `null`/`undefined` — real
parity, not a broader relaxation of `.primary()`'s contract.

## The explicit-required distinction

The exemption covers the `required` that `.primary()` *implies*, never one the
author asked for. `.required()` records a separate `explicitRequired` flag, so
`slug: string().primary().required()` — an author declaring a user-supplied key
mandatory — reports the required error normally, and a create form's pre-check
blocks submission.

That distinction is load-bearing on both sides, so the Store honors it too:
`_instantiate` skips pk auto-generation when the pk descriptor is
`explicitRequired` **and** validation is on (i.e. `createRecord`), letting the
D48 validation throw the required error exactly as `validate()` does. Without
that half, the two surfaces would disagree again in the opposite direction — a
blank explicit-required pk silently filled with a random id.

Auto-generation is retained where validation is off: storage hydration
(`_load`) and server upserts are fail-soft and server-authoritative, and must
not crash on a missing key. Plain `.primary()` auto-generates as always.

`Model.validate(data, { fields })` exposes the same partial-field machinery
`update()` uses, so a form can check only the fields it edits.

## Why not "apply defaults and a synthetic pk inside validate()"

Mutating or augmenting the caller's data inside a checker blurs its contract —
"is this input valid?" becomes "would some derived input be valid?" — and
defaults belong to record construction. Skipping the auto-generatable pk is the
honest statement: the input *is* valid as an input to `createRecord`. (Static
`validate` does apply schema `.default()`s before collecting errors, which is a
different matter: it mirrors what `createRecord` will do to the same payload,
rather than inventing identity.)

## Blast radius

`save()`'s full-record check is unaffected in practice: any record in the store
already has a pk, generated or supplied, so the exemption can never mask a real
missing pk on save. `record.validate()` likewise operates on a constructed
record.

## Coverage

`tests/validation.test.js` — the "createRecord primary-key parity (SPEC §20,
D48)" group: an auto-generated pk satisfying required on plain `.primary()`, a
blank explicit-required primary rejected rather than auto-generated, creation
succeeding when that key IS supplied, plain `.primary()` still auto-generating,
hydration still auto-generating a missing explicit-required pk, and the
pk-immutability check still running ahead of validation.
