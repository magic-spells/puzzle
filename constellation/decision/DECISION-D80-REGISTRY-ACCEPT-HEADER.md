---
name: 'D80 — Registry fetch Accept header (D76 fix)'
status: built
connections:
  - DECISION-D76-CLI-UPGRADE
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
---

# D80 — Registry fetch Accept header (D76 fix)

`FetchLatest` requests `<registry>/@magic-spells/puzzle/latest` with `Accept: application/json`, not the abbreviated `application/vnd.npm.install-v1+json` format the SPEC previously pinned. Amends [[DECISION-D76-CLI-UPGRADE]] / [[DOC-SPEC]] §41.

## Context

The npm registry serves the abbreviated install-v1 format for packuments only; on version endpoints such as `/latest` it answers **406 Not Acceptable**. D76 shipped with the install-v1 header on the `/latest` request, so every registry check failed in production from 0.1.0 on. Nobody noticed because the passive path swallows fetch errors by design: the cache was never written, so the update notice simply never appeared — and `puzzle upgrade`, which shares `FetchLatest`, errored outright. The unit test's fake registry accepted the header instead of emulating npm's 406, which is how the bug survived the suite.

## Decision

Ask for plain `application/json` on the `/latest` request. The version endpoint's payload is small, so the abbreviated format buys nothing there. The test registry now 406s any install-v1 request to a version endpoint, mirroring npm, so a regression to the old header fails the suite.

## Alternatives rejected

- **Fetch the full packument with install-v1 and read `dist-tags.latest`**: keeps the abbreviated format but downloads every version's metadata and adds parsing, all to learn one version string.

## Consequences

One-line change in `compiler/internal/update/update.go` plus the test-registry 406 emulation; §41's contract is otherwise untouched. The passive notice and `puzzle upgrade` work against the real registry for the first time. Gotcha this preserves: the passive path's silent-failure design means a registry-side contract break is invisible to users — anything touching the fetch must be verified against `registry.npmjs.org` itself, not just the httptest double.
