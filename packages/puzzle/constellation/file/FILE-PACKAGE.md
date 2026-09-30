---
name: package.json
status: verified
path: package.json
language: JSON
summary: The public npm manifest — exports map, files allowlist, bin shim, and the pack-time hook wiring.
connections:
  - DOC-RELEASE-SURFACE
  - FLOW-RELEASE
  - DECISION-D120-TARBALL-PUBLISH
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# package.json

The root manifest of the published `@magic-spells/puzzle` package. This card
owns the shape; the release mechanics live on [[FLOW-RELEASE]] and
[[DECISION-D120-TARBALL-PUBLISH]].

- **Exports map** — eight normal subpaths point into `client-runtime/` with a
  `types` condition into `types/`: `.`, `./adapter`, `./morph`, `./router-modes`,
  `./ssg`, `./static`, `./testing`, `./fixtures`. Three are shaped differently:
  `./puzzle-env` is types-only (the `.pzl` ambient-module shim), and
  `./formatters/manifest` and `./i18n/manifest` are bare strings into
  `client-runtime/` with no `types` condition. A new normal subpath needs all
  three of: the exports entry, a `types/<name>.d.ts`, and a
  `tests-types/tsconfig.json` path mapping — without the third it is never
  type-checked.
- **`files` allowlist** — `client-runtime` (with `!client-runtime/**/*.go`
  excluding compiler sources that live under it), `types`, `puzzle-env.d.ts`,
  `bin/puzzle.js`, and `CHANGELOG.md`; enforced both ways by
  `scripts/verify-pack.mjs` against the real packed tarball.
- **No tracked `optionalDependencies`** — the five platform pins (`npm/puzzle-*`)
  are injected by `prepack` and removed by `postpack`; verify-pack fails if the
  working-tree manifest carries them before or after packing. Its
  committed-manifest check reads `git show HEAD:./package.json` — the `./` is
  load-bearing, since a bare `HEAD:package.json` resolves from the monorepo top
  and would inspect the private root shell.
- **`bin`** — the `puzzle` shim that resolves and execs the platform binary,
  keyed by `process.platform`/`process.arch`: the Windows package is
  `puzzle-win32-x64` (not `-windows-`), its file is `bin/puzzle.exe`, and a native
  ARM64 Node on Windows maps to that x64 package.
- The version here is what the release scripts assert against `version.go` and
  the five platform manifests.
