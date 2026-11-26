---
name: fixtures module entry
status: verified
path: client-runtime/fixtures/index.js
language: javascript
summary: >-
  Published ./fixtures entry: installFixtures/uninstall, the seed verbs, the mock interception, and
  the mount wrapper.
connections:
  - COMPONENT-FIXTURES
  - DECISION-D98-FIXTURES-MODULE-FLAG
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# fixtures/index.js

The `@magic-spells/puzzle/fixtures` entry ([[DECISION-D98-FIXTURES-MODULE-FLAG]]):
a module that attaches itself to the core classes, so the core runtime knows
nothing about fixtures. It reaches an app only through a `--fixtures` build (the
compiler generates a wrapper entry, `build/fixtures.go`) or a test import —
`/testing` re-exports `installFixtures`. The core runtime (`app.js`, `store.js`,
views) must never import `fixtures/`.

`installFixtures()` installs the adapter capability, then patches prototypes:
adds `Store.prototype.seed`/`resetFixtureSeed` (so `uninstall()` deletes rather
than restores them), replaces `Store.prototype._network` with the mock
interception (un-mocked types fall through), and wraps `PuzzleApp.prototype.mount`
so the config's `setup` runs at `beforeMount` timing, before navigation zero.
