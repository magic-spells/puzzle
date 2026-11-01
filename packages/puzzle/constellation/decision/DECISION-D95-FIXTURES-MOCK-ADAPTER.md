---
name: D95 — Schema-driven fixtures + the mock adapter
status: verified
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DOC-SPEC
  - DOC-DATASTORE
  - COMPONENT-FIXTURES
  - TEST-PUBLIC-TESTING-SURFACE
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/fixtures/index.js
  - client-runtime/fixtures/generator.js
  - client-runtime/fixtures/mock.js
---

# D95 — Schema-driven fixtures + the mock adapter

`store.seed(type, n)` generates believable records from the model schema alone,
and a per-type mock serves the adapter verbs from an in-memory collection with
configurable latency and failure — so skeletons, `min-duration` holds and
`data()` rejection paths are developable and testable. Everything lives in
`@magic-spells/puzzle/fixtures`; how it installs and ships is
[[DECISION-D98-FIXTURES-MODULE-FLAG]].

## Fixtures (`generator.js`)

Read `Model.normalizedSchema()` / `relationshipDefs()`. Per field, precedence:
explicit override → `belongsTo` FK wiring (to a real existing parent, else
unset) → `.default()` (left absent so `applyDefaults` resolves it) → generated
value. Records go through `createRecord`, so D48 validation, defaults and pk
assignment behave as at runtime. `.oneOf()`/`.min()`/`.max()` are never
violated; nested `array`/`object` shapes the schema doesn't describe are not
invented.

## Mock (`mock.js`)

- Runs as the replacement `_network` — below D91's `_fetch`, so generated
  verbs, D158 enhanced fetch and `request()` are unmodified and `beforeRequest`
  still runs. Author code calling global `fetch` bypasses it.
- Config per type, merged `{ ...Model.adapter?.mock, ...config.mock?.[type] }`
  and active when either exists; the collection is deep-cloned from `data` into
  module WeakMap state keyed by Store. Un-mocked types fall through to the real
  network.
- `latency` (number or `[min, max]`); `failRate` / `fail: true` produce non-ok
  responses that flow through the real error path (`PuzzleAdapterError`, with
  the `status` D161 reads to recognise `404` absence) rather than rejecting the
  fetch. `handler({ method, url, path, body, collection })` covers
  `store.request()`'s arbitrary paths; a falsy return falls through to CRUD.
- Returns a Response-shaped stand-in (the real `Response` isn't uniformly
  available) branded `[Symbol.for('puzzle.response')]: true`, which the
  adapter's `isResponse()` accepts. Each module declares the registry symbol
  itself so `/fixtures` and `/adapter` don't pull each other in.

## Determinism

Two PRNG streams from one seed (`seed` and `seed ^ 0x9e3779b9`): generation and
mock latency/failure rolls. One shared stream would let an added `seed()` call
change which requests fail. `resetFixtureSeed()` resets both and the record
counter. **One hole:** an auto-generated pk comes from `Store._genId`
(random); supply `.primary()` keys for full determinism.

## Gotchas

- Default CRUD never exercises server-assigned pk adoption (`createRecord`
  always assigns a local pk); test it through `handler`.
- Custom `.validate()` predicates are opaque to generation — override the field.
- `store.seed()` records are local and unsynced; a `save()` POSTs into the mock
  collection. There is no way to generate records without inserting them.

## Alternatives rejected

- **A separate mock transport** — would test a parallel write path, not D50's.
- **One shared PRNG stream** — fixture calls would perturb failure rolls.
- **Build-time stripping of `mock` blocks** — would make dev and build differ.
