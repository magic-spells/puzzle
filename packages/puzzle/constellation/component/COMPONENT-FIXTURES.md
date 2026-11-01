---
name: Fixtures and mock adapter (@magic-spells/puzzle/fixtures)
status: verified
connections:
  - FILE-FIXTURES
  - FILE-FIXTURES-GENERATOR
  - FILE-FIXTURES-MOCK
  - FILE-FIXTURES-STATE
  - COMPONENT-ADAPTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-TESTING
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-ADAPTER-SYNC
  - FILE-BUILD
  - FILE-PACKAGE
  - DOC-SPEC-DATA
  - DOC-TESTING
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - DECISION-D157-ADAPTER-SUBPATH
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Fixtures and the mock adapter

The `@magic-spells/puzzle/fixtures` subpath (`client-runtime/fixtures/`): deterministic schema-driven record generation plus an in-memory server, as a module that **attaches itself** to the core classes ([[DECISION-D98-FIXTURES-MODULE-FLAG]]). Prototype patching lets an app opt in without editing its own code, and "never imported" is the whole tree-shake — no build define, no dead branch in core, no core file that knows this feature exists. Author contract: [[DOC-SPEC-DATA]] §52.

## What installing patches

`installFixtures(config)` validates the config, installs the [[COMPONENT-ADAPTER]] capability (the network seam it replaces belongs to that module), and then:

- **adds** `seed()` and `resetFixtureSeed()` to [[COMPONENT-STORE]];
- **replaces** `Store.prototype._network` with the mock interception, which falls through to the captured original for any un-mocked type;
- **wraps** [[COMPONENT-PUZZLE-APP]]'s `mount` so the config's `setup(app)` runs at `beforeMount` timing — after the app's own hook, before navigation zero — by composing into `config.beforeMount` rather than duplicating mount's abort handling.

It returns `uninstall()` (also exported), which restores the two patched members and **deletes** the two added ones, so `typeof store.seed` never lies. It is safe to call when not installed and safe to call twice.

## Two ways in

A build opts in with `--fixtures`, which requires `app/fixtures.js` (or `.ts`) default-exporting `{ seed, mock, setup }` and generates a small wiring entry under `.puzzle/fixtures/` that installs the module before the app boots. The flag is refused with a prerender output mode (build and dev): prerender runs the app in Node, so fixtures would bake generated data into shipped HTML.

A test imports `installFixtures` directly — from here, or via the re-export in [[COMPONENT-TESTING]].

## Generation

The schema already declares the types, so nothing is declared twice. Field-name heuristics keep values readable (an `email` field looks like an email, a `title` like words); a declared `.oneOf()` wins over the type generator; numeric bounds constrain numbers and string lengths; dates hang off a fixed epoch, not the clock. A declared `.default()` is left absent so `applyDefaults` resolves it. `belongsTo` foreign keys wire to a real existing parent or stay unset — a fixture pointing at a nonexistent id is worse than none, and inventing the parent would create records nobody asked for. Every record goes through `createRecord`, so defaults, validation and key assignment behave as in production, and seeded records are unsynced (a later `save()` POSTs).

## The mock

Interception sits at `_network` — after the request hook, instead of the real call. That placement is the design: load, save, delete and custom-request paths run unmodified, so a mocked app exercises the real pipeline in [[FLOW-ADAPTER-SYNC]]. What comes back is a Response-shaped object branded with `Symbol.for('puzzle.response')` (the real `Response` constructor is not uniform across Node and jsdom).

Two config sources merge per key, the fixtures file winning: the model's checked-in `mock` block and the file's `mock[type]`. Either alone mocks a type. Default CRUD dispatches on method plus URL shape; `handler` serves anything deeper. `latency` makes skeletons and their anti-flash hold developable, and `fail`/`failRate` (a 500) are the only supported way to make a `data()` reject on purpose.

## Invariants

- **One seed, two streams.** Value generation and the mock's latency/failure rolls use separate streams from the same seed, so adding a `seed()` call cannot change which requests fail.
- **Per-store state lives in a WeakMap here** (`state.js`); the Store owns none of it.
- **State is created lazily with the seed active at that moment**, so a later install cannot reseed a store that already generated something.
- **Every random draw for a request happens synchronously, before the latency delay** — otherwise a "deterministic" failure would move when the machine gets slower.
- **A mock failure resolves a non-OK response rather than rejecting**, so it flows through the real error contracts.
- **Mock collections are live**: a save followed by a load sees the new record. Seed data is deep-cloned at init, so the array a test passed in is never mutated.

## Gotchas

- **Auto-generated primary keys are the one non-deterministic part** (the Store mints them randomly). Pass explicit ids when a test needs stable keys.
- Install is global and latched. A second `installFixtures()` only swaps the active config — read live, so existing stores and apps pick it up — and only the first install captures the originals.
- The composed `beforeMount` is stamped on the app and branded, so a mount/unmount/re-mount cycle and two apps sharing one config object both compose once instead of running `setup` twice.
- A mocked model warns once per model class that no request reaches its endpoint — a stale mock block is otherwise invisible. Not env-gated; production builds drop `console.*` by default.
- Default CRUD serves the collection and single-segment id paths only; a deeper path needs `handler`, and a falsy `handler` return falls through to CRUD.
- The mock's PUT never re-keys its collection: the stored key wins over one in the body.
- `mock[type]` merges per key, not deeply — an entry overriding one knob replaces the model's value for that knob and inherits the rest.
