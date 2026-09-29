---
name: 0.7.0 — reads take care of themselves
status: built
version: 0.7.0
connections:
  - RELEASE-V0-6-0
  - DOC-RELEASE-SURFACE
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D162-MONOREPO-PACKAGES
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D76-CLI-UPGRADE
  - FLOW-RELEASE
---

# 0.7.0 — reads take care of themselves

Published 2026-09-09, tagged `v0.7.0`; npm `latest`. The first release with a
Windows x64 binary (`@magic-spells/puzzle-win32-x64`, which also serves
Windows on ARM) and the first cut from the monorepo
([[DECISION-D162-MONOREPO-PACKAGES]]), with every package in the train at the
framework version.

Theme: auto-fetching finds ([[DECISION-D161-AUTO-FETCHING-FINDS]]) — a tracked
`findOne`/`findMany` inside `data()` that misses queues a fetch, and the view
commits only when every read is warm; a committed `null` means "does not
exist". Also lazy route views ([[DECISION-D163-LAZY-ROUTE-VIEWS]]), snippets
([[DECISION-D166-SNIPPETS]]), `puzzle check`
([[DECISION-D165-PUZZLE-CHECK]]), component families
([[DECISION-D167-COMPONENT-FAMILIES]]), and the playground WASM compiler core
([[DECISION-D164-PLAYGROUND-WASM-BOUNDARY]]).

Release lesson: a piece manifest named its web components by bare name, so npm
installed `latest`, and eight components had to be published by hand before
the release. [[DECISION-D169-REGISTRY-VERSION-FLOORS]] (0.8.0) turns that into
a checked version floor.

## Upgrade notes

Only apps that pass the `/adapter` capability are affected:

- `loadAll` is `loadMany` everywhere, with no alias; the old name throws.
- Generated read failures are `PuzzleAdapterError` with a `.status`.
- A tracked find for a missing id now fetches; `data()` may run several times
  per navigation, so it must be a pure derivation.
- Prerendered apps fetch at build time: reads need an absolute `apiURL`, or a
  local model seeded in `beforeMount({ store })`. An app-relative read fails
  the build.
- A route `view`/`layout` that is neither a `PuzzleView` subclass nor a
  `lazy()` marker throws from the `Router` constructor.
