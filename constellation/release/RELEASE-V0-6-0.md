---
name: 0.6.0 — pay for what you use
status: built
version: 0.6.0
connections:
  - RELEASE-V0-5-0
  - DOC-RELEASE-SURFACE
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D160-SPA-CODE-SPLITTING
---

# 0.6.0 — pay for what you use

Published 2026-08-15, the current `latest` on npm. The theme is subtraction:
every capability that not every app needs stopped being in every app's bundle.

Server sync moved behind the `./adapter` subpath and is switched on once, by
value, in the app config. Hash and memory routing became imported factories
from `./router-modes`, so an app that never asked for them no longer carries
their fragment parsing, entry stack, or commit/click/scroll branches. Per-view
error fallbacks collapsed into one app-level `errorView`. Dynamic `import()`
can opt into becoming a real lazy chunk.

The default routing mode is **path routing**. That is its name — never
"history" — and you get it by omitting `routerMode` entirely.

Two supporting threads run alongside. A build and dev performance round
(compile caching, a `.puzzle/` scratch dir, warm static rebuilds, route-level
invalidation) attacks rebuild latency rather than shipped bytes. And the
pieces registry moved to an npm transport, which makes `puzzle add piece`
**version-locked**: it resolves `@magic-spells/puzzle-pieces` to the CLI's own
major.minor, falling back to an older minor only with a printed notice. The
matching pieces release must be published at or before the CLI release, or
zero-config `add piece` quietly serves an older minor — or hard-fails when
none exists.

## Upgrade notes

Four breaks. Three fail loudly; the last is quiet and depends on your server.

- **`routerMode` takes a factory, not a string.** Omit it for path routing;
  otherwise
  `import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes'`
  and pass `hashRouter()` or `memoryRouter({ initialPath })`. The
  `routerInitialPath` config field is gone — it folds into `memoryRouter`. A
  leftover `'hash'` or `'memory'` string throws at `new PuzzleApp(...)` naming
  the import: the build succeeds, the app does not boot.
- **Per-view `errorContent()` is removed.** Register one ordinary compiled view
  as `new PuzzleApp({ errorView: AppErrorView })`; it receives
  `{ error, info, retry }` and replaces only the failed view or component. A
  leftover `errorContent()` is silently ignored — nothing reads or reports it —
  so grep for the name before upgrading.
- **Server sync is opt-in.** Import `adapter` from
  `@magic-spells/puzzle/adapter` and pass it in the app config;
  `PuzzleAdapterError` moved to the same subpath. Model
  `static adapter = { endpoint }` declarations are unchanged. Without the
  capability, `record.save()` is a plain `TypeError` at call time.
- **Write responses are shape-checked.** `create`/`update` must resolve to an
  object carrying the primary key, or to nothing. A 2xx body that is neither —
  `"OK"`, `true`, `[]`, `{}`, an object with no primary key — now throws where
  0.5.0 marked the record synced, and an un-synced record means a retried
  `save()` re-POSTs. If your server acknowledges writes without echoing the
  record, write a `create`/`update` function that returns nothing or unwraps
  the envelope. Nothing greps for this; it surfaces on the first save.
