---
name: D149 — payload keys colliding with a computed getter
status: verified
connections:
  - DECISION-D06-COMPUTED-GETTERS
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
verified_at: '2026-08-07T22:43:47.810Z'
verified_sha: f2aef082b4b17fb4ded5da94da53a547e2fe66b1
notes:
  - kind: verified
    text: >-
      Verified against client-runtime/model.js at the 0.5.0 release prep: resolvesToGetterOnly walks
      the chain and halts before Object.prototype, returns on the FIRST descriptor found (own data
      property still shadows an inherited getter), and treats only `set === undefined` accessors as
      getter-only. assignSkipping drops the key and `continue`s outside the dev gate, so the skip
      holds in production while only the warn-once WeakMap<Model, Set<key>> bookkeeping is
      DEV-gated. Covered by tests/model-computed-getter.test.js.
    sha: f2aef082b4b17fb4ded5da94da53a547e2fe66b1
---

# D149 — payload keys colliding with a computed getter

## Context

A computed property ([[DECISION-D06-COMPUTED-GETTERS]]) is an ordinary getter on
the model class. Every record write path funnels through one helper —
`assignSkipping`, shared by `safeAssign` (construction), `safeAssignTracked`
(`update()`), and `safeMerge` (server echo, `loadAll`/`loadOne`, `_upsert`) — and
that helper assigns with `target[key] = src[key]`. ESM is always strict mode, so
assigning a key that resolves to a getter with no setter throws `TypeError`.

The throw lands in the MIDDLE of a `for…of` over `Object.keys(src)`, which is
what makes it more than a noisy error:

- keys iterated before the collision are applied, keys after are not — a record
  left in a state neither the caller nor the server asked for;
- `record._synced = true` runs AFTER `safeMerge` in the save path, so a save
  whose HTTP write already succeeded never records that fact. The next `save()`
  POSTs the same row again;
- `loadAll`/`loadOne` and `new Model(data)` reject outright, so one colliding key
  in a list payload takes down the whole read.

[[DECISION-D49-MODEL-RELATIONSHIPS]] already met this hazard for relationship
names and settled it there: the name is reserved, assignment warns once and is
ignored, explicitly because "a getter-only property would make `Object.assign`
throw in strict mode and crash the exempt server read path." That reasoning was
never extended to plain computed getters, which is the gap this card closes.

## Decision

`assignSkipping` resolves each key along the prototype chain before assigning and
**drops** any key whose resolved descriptor is an accessor with no setter,
warning once per (model class, key) in development. Same posture as D49: the
incoming value is ignored, never thrown on, never silently swallowed without a
diagnostic.

Specifics that matter:

- **The walk stops before `Object.prototype`.** Its dangerous names are already
  covered by `POLLUTION_SKIP`.
- **The FIRST descriptor found wins.** An own data property legitimately shadows
  an inherited getter and stays assignable.
- **Accessors WITH setters are untouched.** D49's warn-once relationship setters
  and any author `set x(v)` keep their behaviour — the rule is getter-*only*.
- **The skip applies in production too.** It is what prevents the throw; only the
  warn-once bookkeeping is dev-gated.
- **`update()` stays atomic for ordinary fields.** `_collectErrors` already runs
  before any assignment, so a validation failure applies nothing. This closes the
  one remaining path by which a partial write could occur.

The measured cost is a prototype walk per merged key (~35–75 ns). No pinned
budget covers this path and the absolute cost is single-digit milliseconds at
ten-thousand-record scale, so no memo is carried; add one only against a real
regression.

## Alternatives rejected

- **`try/catch` around the assignment** — the point is to avoid a half-applied
  record. A catch inside the loop still leaves the earlier keys written and the
  later ones missing, and a catch outside it discards the whole merge.
- **Reserving computed-getter names in the schema** — a computed property is
  deliberately schema-less (D06); requiring registration would re-introduce the
  declaration D06 removed.
- **Throwing a `PuzzleError` naming the collision** — louder, but it still fails
  the read path D49 called out as needing to survive, and it makes a server that
  echoes a harmless extra key fatal to the client.
- **Skipping by name list** — the collision is structural, not lexical; a name
  list would drift from the model class it describes.

## Consequences

- A model may name a computed getter after a field the API returns without
  breaking saves, reads, or sync provenance. The value is ignored and dev says so
  once.
- `_synced` is reached on every successful save, so the duplicate-POST failure
  mode is closed.
- Every record write path inherits the fix at once, because they all share
  `assignSkipping`.
