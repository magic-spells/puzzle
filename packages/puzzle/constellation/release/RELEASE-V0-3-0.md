---
name: 0.3.0 — deprecated, never install
status: built
version: 0.3.0
connections:
  - RELEASE-V0-2-0
  - RELEASE-V0-3-1
  - DECISION-D120-TARBALL-PUBLISH
---

# 0.3.0 — deprecated, never install

Published 2026-07-25 and deprecated the same day. Its registry metadata has no
`optionalDependencies`, so `puzzle` installs with no platform binary and exits
1. `npm publish` on a directory re-reads the manifest after `postpack` strips
the pack-time platform pins; the root must be published as the packed tarball
([[DECISION-D120-TARBALL-PUBLISH]]). [[RELEASE-V0-3-1]] is the same feature set,
published correctly.
