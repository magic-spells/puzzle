---
name: D149 — payload keys colliding with a computed getter or method
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
code_refs:
  - client-runtime/model.js
  - tests/model-computed-getter.test.js
---

# D149 — payload keys colliding with a computed getter or method

## Context

Computed properties ([[DECISION-D06-COMPUTED-GETTERS]]) are plain prototype
getters; model methods are plain prototype functions. Every record write path —
`safeAssign` (construction), `safeAssignTracked` (`update()`), `safeMerge`
(server echo, `loadMany`/`loadOne`, `_upsert`) — funnels through
`assignSkipping` in `client-runtime/model.js`, which assigns `target[key] = v`.

- A key resolving to a **getter-only** property throws in strict mode mid-loop:
  earlier keys land, later ones don't, a successful save never reaches its
  `_synced = true` (next `save()` re-POSTs), and one bad key in a list payload
  rejects the whole read.
- A key resolving to a **method** doesn't throw but writes an own data property
  shadowing it, so the next `update()`/`save()`/`toJSON()` fails as "not a
  function". `toString`/`valueOf` shadowing breaks every template that
  interpolates the record.

## Decision

`resolveCollision` walks the prototype chain (through `Object.prototype`) the
way `[[Set]]` would, and `assignSkipping` **drops** a key that resolves to a
getter-only accessor or an inherited function, warning once per (model class,
key) in development — the posture [[DECISION-D49-MODEL-RELATIONSHIPS]] set for
relationship names.

- The first descriptor found wins: an own data property shadows an inherited
  getter/method and stays assignable.
- Accessors with a setter are untouched (D49 relationship setters, author
  `set x(v)`).
- `POLLUTION_SKIP` (`__proto__`/`constructor`/`prototype`) and reserved record
  fields are skipped before the walk; only the `update()` path warns about a
  reserved key (an author patch mistake; a server payload carrying one is
  routine).
- The skip runs in production; only the warn-once `WeakMap<Model, Set>` is
  dev-gated.
- `update()` stays atomic: `_collectErrors` runs before any assignment.

Cost is a prototype walk per merged key (tens of ns); no memo unless a real
regression shows up.

## Alternatives

- `try/catch` around the assignment — still leaves a half-applied record, or
  discards the whole merge.
- Registering computed names in the schema — re-adds the declaration D06
  removed.
- Throwing a `PuzzleError` — makes a harmless extra server key fatal to reads.
- A name list — the collision is structural and a list drifts from the class.

## Consequences

A model can name a getter or method after a field the API returns without
breaking saves, reads or sync provenance; the value is ignored and dev says so
once. `_synced` is reached on every successful save.
