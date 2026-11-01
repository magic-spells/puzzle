---
name: >-
  D120 — Platform pins are injected at pack time, and the root package is published as the packed
  tarball
status: verified
connections:
  - FILE-PACKAGE
  - FLOW-RELEASE
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - scripts/inject-platform-pins.mjs
  - scripts/verify-pack.mjs
  - scripts/release-prep.mjs
  - scripts/release-checks.mjs
  - scripts/refuse-directory-publish.mjs
  - scripts/verify-published.mjs
---

# D120 — Platform pins are injected at pack time; the root package is published as the packed tarball

The root package's `@magic-spells/puzzle-<platform>-<arch>` optionalDependencies
(one per row of release-prep's build matrix) are **not** in the tracked
manifest: pinned versions don't exist on the registry between a version bump and
the publish, which would break `package-lock.json` and `npm ci`. They are written
at pack time, and the root is published **as the packed `.tgz`**, never as a
directory.

## Decision

- **`prepack`/`postpack`** run `scripts/inject-platform-pins.mjs inject|restore`,
  writing pins equal to the root version and removing them afterwards. The hooks
  log to stderr, because `verify-pack` parses `npm pack --json` stdout.
- **Directory publish is refused.** `npm publish <dir>` packs (firing the hooks),
  then re-reads `package.json` from disk for the registry metadata — after
  `postpack` stripped the pins — so the packument has no optionalDependencies and
  installs a CLI shim with no binary. For a file spec npm reads the manifest from
  the tarball. `prepublishOnly` runs `refuse-directory-publish.mjs`, which always
  fails; npm fires that hook only for a directory publish.
- Publish order: the five platform packages first (plain directory publishes,
  nothing injected), then `npm publish ./magic-spells-puzzle-<version>.tgz
  --access public`.

## What `release:prep` enforces (`scripts/release-prep.mjs`)

- It runs `inject-platform-pins.mjs restore` first, so an aborted pack (npm skips
  `postpack` when the pack fails) can't feed a pinned manifest into a release.
- `verify-pack` packs a real tarball into a temp dir and checks: the tarball's
  `package/package.json` carries exactly the expected pins, each equal to the
  root version; the file list passes the allowlist; the repo manifest is clean
  after packing; and the committed manifest has no optionalDependencies. Its
  expected pin list is compared against the injector's.
- Every platform package is dry-packed and its declared binary must be present
  and non-empty (four of five binaries are cross-compiled and never run on the
  release host).
- The root tarball is packed last and every pin is read back out of the packed
  bytes.

## After publishing: `npm run verify:published [-- <version>]`

Reads the packument (pins, version match, each pinned platform version exists,
`bin.puzzle`), checks `@magic-spells/puzzle-pieces` exists at the exact framework
version and that the installed CLI resolves `add piece` to it (with
`PUZZLE_PIECES_REGISTRY` removed from the env), then installs the published
version into a temp dir and runs `puzzle --version`. `verify:pack` proves the
artifact; `verify:published` proves the release — both are required.
`e2e-pack.mjs` can't catch a missing binary (platform packages are unpublished
when it runs). Pure predicates live in `scripts/release-checks.mjs`
(unit-tested), because the top-level scripts exit on import.

## Gotchas

- `restore` deletes `optionalDependencies` unconditionally — correct only while
  every optional dep is injected at pack time.
- `verify-pack` reads the committed manifest with `git show HEAD:./package.json`;
  the bare `HEAD:package.json` form resolves from the monorepo root and would
  pass vacuously.
