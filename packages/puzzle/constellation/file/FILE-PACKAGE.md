---
name: package.json
status: verified
path: package.json
language: JSON
summary: The public npm manifest — exports map, files allowlist, bin shim, and the pack-time hook wiring.
connections:
  - DOC-RELEASE-SURFACE
  - DECISION-D116-PACK-TIME-PIN-INJECTION
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
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
- **No tracked `optionalDependencies`** — the five platform pins are injected
  by `prepack` and removed by `postpack` (D116); verify-pack fails if the
  working-tree manifest carries them before or after packing; its
  committed-manifest check currently resolves `HEAD:package.json` from the
  monorepo top and so inspects the private root shell, not this file.
- **`bin`** — the `puzzle` shim that resolves and execs the platform binary.
  It keys the platform packages by `process.platform`/`process.arch`, so the
  Windows package is `puzzle-win32-x64` (not `-windows-`) and the file it
  resolves inside it is `bin/puzzle.exe`.
- Also the version source the release scripts assert against `version.go`
  and the five platform manifests.
