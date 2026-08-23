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
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-TESTING
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-ADAPTER-SYNC
  - STATE-RECORD
  - FILE-BUILD
  - FILE-PACKAGE
  - DOC-TESTING
  - DOC-DATASTORE
  - DOC-RELEASE-SURFACE
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D96-FIXTURE-MOCK-TREESHAKE
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D39-SKELETON
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - FEATURE-VALIDATE-PK-PARITY
verified_at: '2026-08-23T19:55:09.920Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

# Fixtures and the mock adapter

The published `@magic-spells/puzzle/fixtures` subpath: deterministic
schema-driven record generation plus an in-memory server, as a module that
**attaches itself** to the core classes. Prototype patching is what lets an app
opt in without editing a line of its own code, and "never imported" is the whole
tree-shake — no build define to fold, no dead branch in core, and no core file
that has to know this feature exists.

## What installing patches

`installFixtures(config)` returns its own `uninstall`. It first installs the
[[COMPONENT-ADAPTER]] capability — the network seam it is about to replace
belongs to that module — and then:

- **adds** `seed()` and `resetFixtureSeed()` to [[COMPONENT-STORE]];
- **replaces** the Store's network seam with the mock interception, which falls
  through to the captured original for any un-mocked type;
- **wraps** [[COMPONENT-PUZZLE-APP]]'s mount so the config's `setup(app)` runs at
  `beforeMount` timing — after the app's own hook, before navigation zero, so
  seeded records are visible to the first `data()`.

`uninstall()` restores the two patched members and **deletes** the two added
ones, so `typeof store.seed` never lies about whether fixtures are available. It
is safe to call uninstalled and safe to call twice.

## Two ways in

A build opts in through the compiler's `--fixtures` flag, which requires
`app/fixtures.js` (or `.ts`) default-exporting `{ seed, mock, setup }` and
generates a small wiring entry in the scratch directory that installs the module
before the app boots. The flag is refused alongside a prerender output mode: the
prerender pass runs the app in Node at build time, so an installed fixtures
module would bake generated data into shipped HTML.

A test opts in by importing `installFixtures` directly — from here, or via the
convenience re-export in [[COMPONENT-TESTING]].

## Generation

The schema already declares the types, so nothing has to be declared twice.
Field-name heuristics keep values readable (an `email` field looks like an
email, a `title` like words); a declared allow-list wins over the type
generator, because generating a value the schema would reject is worse than
useless; numeric bounds constrain numbers and string *lengths*; dates hang off a
fixed epoch rather than the clock. `belongsTo` foreign keys wire to a real
existing parent or stay unset — a fixture pointing at a nonexistent id is worse
than one with no parent, and inventing the parent would create records nobody
asked for. Every generated record goes through the ordinary create path, so
defaults, validation, and key assignment behave exactly as in production.

## The mock

Interception sits at the network seam, i.e. *after* the request hook and instead
of the real call. That placement is the entire design: the load, save, delete,
and custom-request paths run completely unmodified, so a mocked app exercises
the real pipeline described in [[FLOW-ADAPTER-SYNC]] rather than a parallel
test-only one. What comes back is a Response-*shaped* object carrying exactly
the members that pipeline reads.

Two config sources merge per key with the fixtures file winning: the model's own
checked-in `mock` block and the file's `mock[type]` entry. Either alone is
enough to mock a type. Default CRUD is dispatched on method plus URL shape, a
`handler` hook serves anything deeper, and the two knobs exist because the
runtime has no other way to reach those states — latency makes skeletons and
their anti-flash hold developable, and forced failure is the only supported way
to make a `data()` reject on purpose.

## Invariants

- **One seed, two streams.** Value generation and the mock's latency/failure
  rolls draw from separate streams derived from the same seed, so adding a
  `seed()` call to a test cannot silently change which requests fail.
- **Per-store state lives here, in a WeakMap.** The Store owns none of it, and
  entries die with the stores that own them.
- **State is created lazily, with the seed active at that moment.** A later
  install therefore cannot retroactively reseed a store that has already
  generated something — which is exactly what makes a sequence reproducible.
- **Every random draw for a request happens synchronously, before the latency
  delay.** A "deterministic" failure that moves when the machine gets slower is
  not deterministic.
- **A mock failure resolves a non-OK response rather than rejecting**, so it
  flows through the real error contracts instead of surfacing as a network
  exception nothing has a contract for.
- **Mock collections are live and owned by fixture state**: a save followed by a
  load sees the new record. Seed data is deep-cloned at init, so the array a test
  passed in is never mutated underneath it.

## Gotchas

- **Auto-generated primary keys are the one non-deterministic part.** Fixtures
  leave the key to the Store, which mints it randomly. Pass explicit ids when a
  test needs stable keys.
- Install is global and latched. A second `installFixtures()` only swaps the
  active config — which is read live, so already-constructed stores and apps pick
  up the change — and only the first install captures the originals.
- The mount wrapper composes into `config.beforeMount` and brands the composed
  hook, so a mount/unmount/re-mount cycle and two apps sharing one config object
  both compose once instead of running `setup` twice.
- A mocked model warns once per model class that no request is reaching its
  endpoint. A stale mock block is the failure nobody notices otherwise.
- Default CRUD serves the collection and single-segment id paths only; a deeper
  path needs `handler`, and a falsy `handler` return falls through to CRUD.
- The mock's update never re-keys its collection: the stored key wins over one in
  the body.
- `mock[type]` merges per key, not deeply — an entry overriding one knob replaces
  the model's value for that knob and inherits the rest.
