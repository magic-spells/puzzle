---
name: 0.3.1 — the correct 0.3
status: built
version: 0.3.1
connections:
  - RELEASE-V0-3-0
  - DECISION-D120-TARBALL-PUBLISH
  - DECISION-D116-PACK-TIME-PIN-INJECTION
  - DECISION-D94-TESTING-EXPORT
---

# 0.3.1 — the correct 0.3

Published 2026-07-25, the same day as the version it replaces. No code
changes: 0.3.1 exists only because 0.3.0's registry metadata went out without
platform pins and left every install without a working `puzzle` binary. Treat
0.3.1 as the real 0.3 release and 0.3.0 as a tombstone.

The fix is that the publish path is now guarded rather than remembered. The
root ships as the packed tarball, `prepublishOnly` refuses a directory publish
outright, and `npm run verify:published` inspects the metadata the registry
actually resolves against — the only check that would have caught this, since
every local check passed.

Theme, inherited from 0.3.0: making Puzzle apps testable. `./testing` supplies
the knowledge only the framework has about when an app has settled; `./fixtures`
supplies believable data from the schema alone and a mock adapter, bundled only
behind a flag.

## Upgrade notes

Coming from **0.3.0**: reinstall. Nothing in your app changes.

Coming from **0.2.x**, four breaks:

- **Production source maps are opt-in.** Set `build.sourceMap: true` to get the
  linked `.js.map` back; otherwise your original source structure stops being
  deployed.
- **Managed head tags are build-time only.** `og:*`, `twitter:*`, and
  `canonical` are baked per page by the prerenderer. An SPA-only app that
  relied on them being applied at runtime will no longer see them.
  `document.title` sync is unaffected.
- **`dev.proxy` rejects two prefix shapes at config load:** a `/` root proxy,
  and two keys naming the same route after trailing-slash normalization.
- **A bare `YYYY-MM-DD` is a calendar date**, parsed as local midnight rather
  than the ES spec's UTC midnight, so date formatters stop showing readers west
  of UTC the previous day. Values carrying their own time or zone are
  untouched.
