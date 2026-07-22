---
name: "D48 — Schema validation enforces at the local write boundary: throw on write, { valid, errors } to render (v1.16)"
status: verified
connections:
  - DECISION-D05-SCHEMA-BUILDERS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - FEATURE-SCHEMA-VALIDATION
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
verified_at: '2026-07-12T00:14:57.604Z'
verified_sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
notes:
  - kind: verified
    text: >-
      Decision implemented as written and verified at the merged main sha (480 vitest green); no
      deviations from the recorded contract.
    sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
---

# D48 — Schema validation enforces at the local write boundary: throw on write, `{ valid, errors }` to render (v1.16)

Supersedes the §7 "enforcement deferred" line. The rules the [[DECISION-D05-SCHEMA-BUILDERS]]
builders have stored since v1 (`required`, `min`, `max`, `oneOf`, `validate`) now enforce:
`store.createRecord()` and `record.update()` throw `PuzzleValidationError` on invalid data,
and `Model.validate(data)` / `record.validate()` return a renderable `{ valid, errors }`
without throwing. See [[DOC-SPEC]] §20.

## Context
Since v1 the builders accumulate validation rules on the normalized descriptor, but they
were inert metadata — invalid data flowed silently into the store. [[DOC-MODELS]] made an
explicit forward promise: "Declare your rules now; they become active when enforcement
lands, without schema changes." The open questions from the backlog card: throw vs
Ember-style `record.errors`, and always-on vs opt-in.

## Decision
- **Throw at the write boundary.** `createRecord(type, data)` (after defaults + pk
  generation) and `record.update(patch)` (patched fields only) throw
  `PuzzleValidationError` — exported from the package root — with `.errors` as
  `[{ field, rule, message }]` in schema-declaration order. Invalid data **never enters
  the store**: a failed create inserts/notifies/persists nothing; a failed update leaves
  the record untouched. Throwing keeps both methods' return-the-record contract
  (`toggle() { return this.update({...}) }` chains) and matches the framework's
  fail-fast posture for programming-adjacent errors (router config throws, pk
  immutability throw).
- **`{ valid, errors }` is the renderable surface, not stored errors state.** Static
  `Model.validate(data)` (pre-create form check) and instance `record.validate()`
  (current field values) return the same shape without throwing — form UX validates
  first, then writes. (Rejected: a persistent `record.errors` property à la Ember —
  records ARE instances of the user's class rendered in templates; mutable framework
  state on them leaks into `toJSON()`/spreads or demands non-enumerable bookkeeping,
  and reactive error display already has a home in component state.)
- **Always-on at the local write API; server + hydration paths exempt.** No opt-out
  flag: enforcement only fires where an app *declared* rules, and the docs promised
  exactly this activation. `loadAll`/`loadOne` upserts skip validation (the server is
  authoritative — a backend quirk must not crash the read path), and storage hydration
  skips it (fail-soft startup, same posture as the duplicate-pk skip). (Rejected:
  per-call `{ validate: false }` — an escape hatch nobody asked for yet; can layer on
  compatibly if real demand appears.)
- **Rule semantics** (no type coercion anywhere — rules compare what they're given):
  `required` fails on `undefined`/`null`/`''`; a non-required field that is
  `undefined`/`null` skips its remaining rules; `min`/`max` compare `.length` for
  strings/arrays and value for numbers/dates; `oneOf` is strict `===` membership;
  custom `validate(fn)` treats a falsy return as invalid and lets a *thrown* exception
  propagate (a broken validator is a programming error, not a validation failure).
  `required` runs first per field and short-circuits that field's remaining rules; all
  failing fields are collected. Type mismatches (a number in a `string()` field) are
  **not** validated — type checking would be its own decision.
- **`update()` validates only the fields present in the patch.** Field rules are
  per-field, so this is exact — and it means a record created under older, laxer rules
  cannot be bricked by an unrelated update.

## Alternatives rejected
- `record.errors` stored state, opt-in enforcement, per-call bypass flag — covered above.
- Validating server upserts — crashes apps on backend drift for zero local-authoring value.
- Returning a result object from `createRecord`/`update` instead of throwing — breaks the
  documented return-the-record chaining contract everywhere for the invalid-data case only.

## Consequences
Runtime-only (model.js + store.js + index.js export); no compiler, router, or view
changes. Apps with declared rules now get real enforcement — the documented activation,
not a break; apps without rules see zero behavior change. Natural foundation for
[[FEATURE-ADAPTER-WRITE-SYNC]] (validate before sync). Default messages (when the
modifier's `message` arg is omitted) name the field and the bound; exact strings live in
model.js and the validation suite.
