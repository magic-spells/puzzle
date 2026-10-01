---
name: 'D49 — `hasMany`/`belongsTo`: lazy store-backed getters with FK by convention'
status: verified
connections:
  - DECISION-D05-SCHEMA-BUILDERS
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D161-AUTO-FETCHING-FINDS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
  - DOC-SPEC-DATA
verified_at: '2026-08-24T21:39:15.808Z'
code_refs:
  - client-runtime/model.js
  - client-runtime/datastore/store.js
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D49 — `hasMany`/`belongsTo`: lazy store-backed getters with FK by convention

`Puzzle.belongsTo(type)` / `Puzzle.hasMany(type)` in a model's `static schema` install lazy prototype getters that resolve against the local store. See [[DOC-SPEC-DATA]] §21.

## Decision
- **Lazy getters over the live store; never fetch.** `post.author` resolves the `user` with `post.authorId`; `post.comments` resolves the `comment` records whose FK matches. The lookups record the same subscription keys as `findOne`/`findMany`, so a traversal inside a tracked `data()` subscribes exactly like the manual join it replaces — but they bypass fault-in ([[DECISION-D161-AUTO-FETCHING-FINDS]]): `post.author` across a 50-row list must not become 50 GETs. Fetching a missing related record is one more tracked find in `data()`. Outside a tracked run a traversal reads current state without subscribing; the idiom is "return the traversal from `data()`".
- **FK by convention, overridable.** `belongsTo` infers `<relationshipName>Id` (`author` → `authorId`); `hasMany` infers `<ownerTypeName>Id` (`post`'s `comments` → `postId`). `{ key: '…' }` overrides. Inference uses the model registry key; FK-to-pk comparison uses the coerced identity `findOne` uses ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]).
- **Relationships are schema entries, not fields.** They are excluded from `normalizedSchema()`, so defaults, pk lookup and validation ([[DECISION-D48-SCHEMA-VALIDATION]]) never see them; prototype getters are not own-enumerable, so `toJSON()` serializes the FK, never the object graph.
- **The Store constructor installs them** for registered models (idempotent, per prototype — the first registration's inferred FK wins); each getter routes through the record's own `_store`. Unregistered classes get none; a record with no store resolves `null`/`[]`.
- **The property name is reserved.** Incoming data carrying it (`{ author: {…} }`) hits a warn-once setter that drops the value and points at the FK field — a getter-only property would make `Object.assign` throw on the exempt server read path.
- `hasMany` order is store insertion order; sort in `data()`. Cycles are safe (lazy).

## Alternatives rejected
- Eager materialization — stale copies plus an invalidation protocol. Inverse bookkeeping and many-to-many — out of scope.
- Relationship fault-in — N+1 request storms from list views.
- Template-side reactive traversal — render runs outside the tracked evaluation by design.
- A `.key()` chain modifier — relationship builders share nothing with field builders; one options object is the obvious spelling.
- Throwing on assignment to the reserved name, or silently swallowing it.
