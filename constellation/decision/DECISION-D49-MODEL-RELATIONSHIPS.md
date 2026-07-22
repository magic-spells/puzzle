---
name: "D49 — hasMany/belongsTo resolve as lazy store-backed getters with FK-by-convention (v1.17)"
status: verified
connections:
  - DECISION-D05-SCHEMA-BUILDERS
  - DECISION-D48-SCHEMA-VALIDATION
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - FEATURE-MODEL-RELATIONSHIPS
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
verified_at: '2026-07-12T00:14:58.605Z'
verified_sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
notes:
  - kind: verified
    text: >-
      Decision implemented as written and verified at the merged main sha (480 vitest green); blog
      acceptance case landed; no deviations from the recorded contract.
    sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
---

# D49 — `hasMany`/`belongsTo` resolve as lazy store-backed getters with FK-by-convention (v1.17)

Activates the schema entries reserved since v1 (SPEC §7). `Puzzle.belongsTo(type)` /
`Puzzle.hasMany(type)` in a model's `static schema` now install **lazy prototype
getters** that resolve against local store contents through the ordinary query path —
so reactivity falls out of the existing subscription machinery for free. See
[[DOC-SPEC]] §21.

## Context
Related records were hand-joined in every `data()` (`store.findMany('comment',
{ filter: c => c.postId === params.id })` — the blog's PostDetail is the canonical
case). The reserved builders needed: a foreign-key convention, lazy vs eager
resolution, and a story for how subscription tracking sees a traversal.

## Decision
- **Lazy getters over the live store; no materialization.** `post.author` ⇒
  `store.findOne('user', post.authorId)`; `post.comments` ⇒ `store.findMany('comment',
  { filter: c => c.postId === post.id })`. Because they call the ordinary query
  methods, a traversal made inside a tracked `data()` evaluation **auto-subscribes
  exactly like the manual join it replaces** — no new reactivity machinery. Outside a
  tracked eval (template-only access) it reads current state without subscribing; the
  documented idiom stays "return the traversal from `data()`". (Rejected: eager
  materialization — stale copies plus an invalidation protocol, for nothing.)
- **FK by convention, overridable.** `belongsTo` infers `<relationshipName>Id`
  (`author:` → `authorId`); `hasMany` infers `<ownerTypeName>Id` (`post`'s `comments:`
  → `postId`). Both accept `{ key: '...' }` to override. Inference uses the model
  registry key, resolved when the Store installs getters at construction. Both blog
  conventions match with zero options.
- **Relationships are schema entries but not fields.** A distinct builder kind:
  excluded from `normalizedSchema()` field iteration, so defaults, primary-key lookup,
  and **D48 validation** never see them; `toJSON()` is untouched because prototype
  getters are not own-enumerable — records serialize their FK, never the resolved
  object graph.
- **Installed by the Store constructor** for registered models (idempotent). A
  relationship only means something relative to a registry — resolution IS a store
  query. Store-less/unregistered classes simply have no getter installed.
- **The property name is reserved; assignment warns and is ignored.** Incoming data
  carrying the relationship's name (an embedded server payload: `{ author: {...} }`)
  hits a warn-once setter that drops the value and points at the FK field — a
  getter-only property would make `Object.assign` throw in strict mode and crash the
  exempt server read path. (Rejected: throwing on assign; silently swallowing.)
- **`hasMany` order is store insertion order** (findMany semantics); sort in `data()`
  like any query.

## Alternatives rejected
- Eager materialization / inverse bookkeeping / many-to-many — out of scope per the
  backlog card; fault-in of missing records is [[FEATURE-ADAPTER-WRITE-SYNC]]-layer.
- A reactive template-side traversal (subscribing during render) — render runs outside
  the tracked eval by design (D17/D23); changing that is its own decision.
- `.key()` chain modifier — an options object is one obvious spelling, and
  relationship builders deliberately share nothing with field builders.

## Consequences
Runtime-only (model.js builders + store.js getter install); no compiler changes. The
blog's PostDetail manual joins collapse to two schema lines + traversals in `data()`
with identical rendered output (the acceptance case). Cycles are safe (lazy). D48
validation and relationships compose: rules never fire on relationship entries.
