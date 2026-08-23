---
name: "D49 — hasMany/belongsTo resolve as lazy store-backed getters with FK-by-convention (v1.17)"
status: verified
connections:
  - DECISION-D05-SCHEMA-BUILDERS
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D161-AUTO-FETCHING-FINDS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - FEATURE-MODEL-RELATIONSHIPS
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
  - DOC-SPEC-DATA
  - FEATURE-ADAPTER-WRITE-SYNC
verified_at: '2026-08-23T19:13:15.487Z'
notes:
  - kind: verified
    text: >-
      Decision implemented as written and verified at the merged main sha (480 vitest green); blog
      acceptance case landed; no deviations from the recorded contract.
  - kind: verified
    text: >-
      All mechanical claims confirmed post-merge (builders, lazy getters, FK inference + D112
      coerced identity, D48/normalizedSchema exclusion, reserved-name setter, insertion order, no
      fault-in; relationships + auto-fetching suites green). Consequences corrected: PostDetail
      traverses comments only — author stays an explicit tracked findOne so D161 faults the missing
      user in. Card now binds model.js + datastore/store.js via code_refs.
    sha: 516f7d62ef156359eab7170d68103dc78e6bbb8f
code_refs:
  - client-runtime/model.js
  - client-runtime/datastore/store.js
verified_sha: 516f7d62ef156359eab7170d68103dc78e6bbb8f
---

# D49 — `hasMany`/`belongsTo` resolve as lazy store-backed getters with FK-by-convention (v1.17)

Activates the schema entries reserved since v1 (SPEC §7). `Puzzle.belongsTo(type)` /
`Puzzle.hasMany(type)` in a model's `static schema` install **lazy prototype
getters** that resolve against local store contents through local-only lookups
recording the same subscription keys as the public finds — so reactivity falls
out of the existing subscription machinery for free, and a traversal never
issues a request. See [[DOC-SPEC-DATA]] §21.

## Context
Related records were hand-joined in every `data()` (`store.findMany('comment',
{ filter: c => c.postId === params.id })` — the blog's PostDetail is the canonical
case). The reserved builders needed: a foreign-key convention, lazy vs eager
resolution, and a story for how subscription tracking sees a traversal.

## Decision

- **Lazy getters over the live store; no materialization; never fault-in.**
  `post.author` resolves the `user` with `post.authorId`; `post.comments`
  resolves the `comment` records whose FK matches — through private local-only
  lookups that record the same subscription keys as `findOne`/`findMany` but
  bypass [[DECISION-D161-AUTO-FETCHING-FINDS]] fault-in. A traversal made
  inside a tracked `data()` evaluation **auto-subscribes exactly like the
  manual join it replaces** — no new reactivity machinery — and a later query
  that inserts the related record still reacts. A traversal never issues a
  request: `post.author` across a 50-row list must not become 50 GETs; fetching
  a missing related record is one more tracked find in `data()`. Outside a
  tracked eval (template-only access) it reads current state without
  subscribing; the documented idiom stays "return the traversal from
  `data()`". (Rejected: eager materialization — stale copies plus an
  invalidation protocol, for nothing.)
- **FK by convention, overridable.** `belongsTo` infers `<relationshipName>Id`
  (`author:` → `authorId`); `hasMany` infers `<ownerTypeName>Id` (`post`'s `comments:`
  → `postId`). Both accept `{ key: '...' }` to override. Inference uses the model
  registry key, resolved when the Store installs getters at construction. Both blog
  conventions match with zero options. FK-to-pk comparison uses the same coerced
  identity as `findOne` (D112).
- **Relationships are schema entries but not fields.** A distinct builder kind:
  excluded from `normalizedSchema()` field iteration, so defaults, primary-key lookup,
  and **D48 validation** never see them; `toJSON()` is untouched because prototype
  getters are not own-enumerable — records serialize their FK, never the resolved
  object graph.
- **Installed by the Store constructor** for registered models (idempotent). A
  relationship only means something relative to a registry — resolution IS a store
  query. Unregistered classes get no getter at all; a registered class's record
  with no store attached resolves `null`/`[]`. Install is per prototype — the
  first registration's inferred FK wins — and the getter routes through each
  record's own `_store`.
- **The property name is reserved; assignment warns and is ignored.** Incoming data
  carrying the relationship's name (an embedded server payload: `{ author: {...} }`)
  hits a warn-once setter that drops the value and points at the FK field — a
  getter-only property would make `Object.assign` throw in strict mode and crash the
  exempt server read path. (Rejected: throwing on assign; silently swallowing.)
- **`hasMany` order is store insertion order** (findMany semantics); sort in `data()`
  like any query.

## Alternatives rejected
- Eager materialization / inverse bookkeeping / many-to-many — out of scope per the
  backlog card. Relationship fault-in is rejected in
  [[DECISION-D161-AUTO-FETCHING-FINDS]]: traversals stay local so list views
  can't trigger N+1 request storms.
- A reactive template-side traversal (subscribing during render) — render runs outside
  the tracked eval by design (D17/D23); changing that is its own decision.
- `.key()` chain modifier — an options object is one obvious spelling, and
  relationship builders deliberately share nothing with field builders.

## Consequences

Runtime-only (model.js builders + store.js getter install); no compiler changes. The
blog's PostDetail manual joins collapse to two schema lines: `post.comments` is a
direct traversal, while `author` stays an explicit tracked `findOne` on the FK — a
relationship never fetches, so the find is what faults a missing user in (D161) and
lands it in the store for `post.author` and every other consumer. Cycles are safe
(lazy). D48 validation and relationships compose: rules never fire on relationship
entries.
