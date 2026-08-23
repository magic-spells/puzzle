---
name: package.json
status: verified
path: package.json
language: JSON
summary: The public npm manifest — exports map, files allowlist, bin shim, and the pack-time hook wiring.
connections:
  - DOC-RELEASE-SURFACE
  - DECISION-D116-PACK-TIME-PIN-INJECTION
verified_at: '2026-08-16T04:34:34.488Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# package.json

The root manifest of the published `@magic-spells/puzzle` package. This card
owns the shape; per-mechanism rationale lives on the connected cards.

- **Exports map** — eight subpaths follow the same pattern, each pointing into
  `client-runtime/` with a `types` condition into `types/`: the root (`.`),
  `./adapter`, `./morph`, `./router-modes`, `./ssg`, `./static`, `./testing`,
  and `./fixtures`. Two are shaped differently — `./puzzle-env` is types-only
  (the `.pzl` ambient-module shim) and `./formatters/manifest` is a bare
  string into `client-runtime/formatters/builtins-all.js` with no `types`
  condition. A new subpath of the normal shape needs all three of: the exports
  entry, a `types/<name>.d.ts`, and a `tests-types/tsconfig.json` path
  mapping — the `/static` subpath shipped without the third and was never
  type-checked until the 0.3.0 round.
- **`files` allowlist** — `client-runtime` (with `!client-runtime/**/*.go`
  excluding the compiler sources that live under it), `types`,
  `puzzle-env.d.ts`, `bin/puzzle.js`, and `CHANGELOG.md`; enforced two-sidedly
  by `scripts/verify-pack.mjs` against the REAL packed tarball
  ([[DECISION-D116-PACK-TIME-PIN-INJECTION]]).
- **No tracked `optionalDependencies`** — the four platform pins are injected
  by `prepack` and removed by `postpack` (D116); verify-pack fails if the
  working-tree OR committed manifest carries them.
- **`bin`** — the `puzzle` shim that resolves and execs the platform binary.
- Also the version source the release scripts assert against `version.go`
  and the four platform manifests.
