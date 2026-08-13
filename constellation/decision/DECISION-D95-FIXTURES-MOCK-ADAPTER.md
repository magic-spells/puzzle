---
name: D95 — Schema-driven fixtures + the mock adapter (v1.57)
status: built
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D96-FIXTURE-MOCK-TREESHAKE
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DOC-SPEC
  - DOC-DATASTORE
---

`store.seed(type, n)` generates believable records from the schema alone, and
`static adapter = adapter({ endpoint, mock: … })` serves the adapter verbs from
an in-memory collection with configurable latency and failure.

**Integration reshaped by [[DECISION-D98-FIXTURES-MODULE-FLAG]] (v1.61):** everything below about *what* seed/mock do still holds, but the code now lives entirely in `@magic-spells/puzzle/fixtures` and attaches via `installFixtures(config)` (prototype patching + a WeakMap for state) instead of being baked into `store.js`; the `fixtureSeed` app/Store option became the install config's `seed`; and per-type mock config can also come from the install config, merged over `static adapter.mock`.

## Context

Two gaps, both blocking real work.

There was no way to populate a store without hand-writing every record. And there was no supported way to develop or test against a slow or failing API: `<puzzle-skeleton>` and its `min-duration` anti-flash (D39/D52) are undevelopable against a localhost server answering in 2 ms, and there was **no way at all to trigger a `data()` rejection on purpose** — even though D52 settled the declarative error slot as won't-build specifically on the grounds that authors should "catch in `data()` and return an error model." The framework asked for error handling it gave no way to exercise.

Puzzle is unusually well-placed here because **the schema already declares the types**. `Puzzle.string()`, `.oneOf()`, `.min()/.max()`, `belongsTo`, `hasMany` carry enough information to generate fixtures with no extra declaration — something Mirage could never do for Ember Data's looser schemas.

## Decision

**Fixtures** read `Model.normalizedSchema()` / `relationshipDefs()`. Precedence: explicit overrides → `belongsTo` FK wiring → `.default()` (left *absent* so `applyDefaults` resolves it, preserving function-default and deep-clone semantics) → generated value. Records go through the normal `createRecord` path, so D48 validation, defaults, and pk assignment behave exactly as at runtime — a fixture that could not exist in production is worthless. `.oneOf()`/`.min()`/`.max()` are never violated. A `belongsTo` FK wires to a real existing parent when one exists and is left unset otherwise, rather than pointing at a nonexistent id.

**The mock adapter replaces `Store._network`**, installed by the D157 adapter
factory after D91's `_fetch` hook, and returns a **Response-shaped object**. That
placement keeps `loadAll`/`loadOne`/`save`/`delete`/`request` completely
unmodified while `beforeRequest` still runs. The collection lives in fixture
module WeakMap state keyed by Store and is deep-cloned from `mock.data`.

`latency` (a number or `[min, max]`) is the knob that makes skeletons developable. `failRate` and `fail: true` produce non-ok responses that flow through the real error paths — `PuzzleAdapterError` for writes, the D21 throw for reads — rather than rejecting the fetch itself. `handler({ method, url, path, body, collection })` is the escape hatch for `store.request()`'s arbitrary paths, falling through to default CRUD on a falsy return.

**Two PRNG streams, not one**, both derived from a single `fixtureSeed` (`seed` and `seed ^ 0x9e3779b9`). Sharing one stream means adding a `seed()` call to a test silently changes *which requests fail* — a genuinely nasty flake source. `resetFixtureSeed()` resets both plus the record counter.

## Consequences

- Skeletons, `min-duration` holds, and `data()` rejection paths are all developable and testable for the first time.
- Composes with D91: `beforeRequest` still runs in mock mode, so a test can assert the hook fired, but no network call happens.
- **Determinism has one documented hole.** "Let the existing pk machinery assign the key" and "byte-identical fixtures" cannot both hold — `Store._genId` uses `Math.random()` + `Date.now()`. The pk rule won, so the **auto-generated pk is the single non-deterministic field**; everything else is byte-identical. A model with an author-supplied `.primary().required()` key is fully deterministic, and callers needing stable ids pass them. Fixing this properly means changing `_genId`, which is core store behavior and out of scope here.
- **Server-assigns-its-own-key pk adoption is unreachable through default CRUD.** `createRecord` always assigns a local pk, so the spec'd POST semantics ("assign one if absent") honor it and adoption never fires. That path is exercised through `handler`, which is still the real `save()` path. Making POST always reassign would silently re-key every seeded record.
- **Custom `.validate()` predicates are opaque to generation** — a generated value can fail one, surfacing as the normal `PuzzleValidationError` at `createRecord`. The fix is an override.
- `store.seed()` and `adapter.mock.data` are independent: seeded records are local and unsynced, so a `save()` POSTs *into* the mock collection. There is no supported way today to generate a fixture array without inserting records.
- **Production exclusion is structural under [[DECISION-D98-FIXTURES-MODULE-FLAG]].**
  Without `--fixtures` or a direct test import, nothing references this module.
  `/fixtures` explicitly imports `/adapter` because the mock needs its network
  seam; core references neither.

## Alternatives rejected

- **A separate mock transport** instead of intercepting at `_fetch` — would bypass the D50 write path and test a parallel implementation rather than the real one.
- **Using the real `Response` constructor** — not uniformly available in the target environments.
- **One shared PRNG stream** — makes fixture calls silently perturb failure rolls.
- **Build-time stripping of `mock` blocks** — needs compiler work and would make a `mock` block behave differently under `puzzle dev` and `puzzle build`, silently deleting behavior someone may want for a demo build. D96's usage-scan gate achieves the byte saving without that divergence.
- **Gating the warn-once to production** — theater, since `dropConsole` already removes it there.
- **Generating nested `array`/`object` shapes** the schema does not describe — invents structure the app never declared.
