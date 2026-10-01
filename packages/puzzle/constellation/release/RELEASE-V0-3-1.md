---
name: 0.3.1 — testable apps
status: built
version: 0.3.1
connections:
  - RELEASE-V0-3-0
  - DECISION-D120-TARBALL-PUBLISH
  - DECISION-D94-TESTING-EXPORT
---

# 0.3.1 — testable apps

Published 2026-07-25; the correct publish of 0.3.0's feature set. Theme:
making Puzzle apps testable — the `./testing` subpath (settling, mounting,
render measurement) and the `./fixtures` subpath (schema-derived data and a
mock adapter, bundled only behind `--fixtures`). The publish path is guarded
since: `prepublishOnly` refuses a directory publish and
`npm run verify:published` checks the metadata the registry resolves.

## Upgrade notes (from 0.2.x)

- Production source maps are opt-in: `build.sourceMap: true`.
- Managed head tags (`og:*`, `twitter:*`, `canonical`) are build-time only,
  baked by the prerenderer; `document.title` sync is unchanged.
- `dev.proxy` rejects a `/` root prefix and duplicate routes at config load.
- A bare `YYYY-MM-DD` is a calendar date, parsed at local midnight.
