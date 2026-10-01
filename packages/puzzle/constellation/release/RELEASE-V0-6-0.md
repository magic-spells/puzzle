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

Published 2026-08-15. Capabilities not every app needs left the default
bundle: server sync behind `./adapter`, hash and memory routing as factories
from `./router-modes`, one app-level `errorView`, and opt-in code splitting.
Also the build/dev performance round and the npm transport for pieces, which
makes `puzzle add piece` resolve pieces at the CLI's own major.minor.

## Upgrade notes

- `routerMode` takes a factory: omit it for path routing, or pass
  `hashRouter()` / `memoryRouter({ initialPath })` from
  `@magic-spells/puzzle/router-modes`. `routerInitialPath` is gone. A leftover
  string throws at `new PuzzleApp(...)`.
- Per-view `errorContent()` is removed and silently ignored — register
  `new PuzzleApp({ errorView })`, which receives `{ error, info, retry }`.
- Server sync is opt-in: pass `adapter` from `@magic-spells/puzzle/adapter` in
  the app config (`PuzzleAdapterError` moved there too). Without it
  `record.save()` is a `TypeError`.
- `create`/`update` must resolve to an object carrying the primary key, or to
  nothing; any other 2xx body throws.
