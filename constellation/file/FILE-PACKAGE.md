---
name: package.json
status: built
path: package.json
language: JSON
summary: The public npm manifest — exports map, files allowlist, bin shim, and the pack-time hook wiring.
connections:
  - DOC-RELEASE-SURFACE
  - DECISION-D116-PACK-TIME-PIN-INJECTION
  - DOC-BLOG-EXAMPLE
---

# package.json

The root manifest of the published `@magic-spells/puzzle` package. This card
owns the shape; per-mechanism rationale lives on the connected cards.

- **Exports map** — six subpaths, each pointing into `client-runtime/` with a
  `types` condition into `types/`: the root (`.`), `./morph`, `./ssg`,
  `./static`, `./testing`, `./fixtures`, plus `./puzzle-env` for the `.pzl`
  ambient-module shim. A new subpath needs all three of: the exports entry,
  a `types/<name>.d.ts`, and a `tests-types/tsconfig.json` path mapping —
  the `/static` subpath shipped without the third and was never type-checked
  until the 0.3.0 round.
- **`files` allowlist** — `client-runtime`, `types`, `puzzle-env.d.ts`,
  `bin/puzzle.js`; enforced two-sidedly by `scripts/verify-pack.mjs` against
  the REAL packed tarball ([[DECISION-D116-PACK-TIME-PIN-INJECTION]]).
- **No tracked `optionalDependencies`** — the four platform pins are injected
  by `prepack` and removed by `postpack` (D116); verify-pack fails if the
  working-tree OR committed manifest carries them.
- **`bin`** — the `puzzle` shim that resolves and execs the platform binary.
- Also the version source the release scripts assert against `version.go`
  and the four platform manifests.

[[DOC-BLOG-EXAMPLE]] binds here for its dependency pins only.
