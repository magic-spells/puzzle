---
name: >-
  D120 — Platform pins are injected at pack time, and the root package is published as the packed
  tarball
status: verified
connections:
  - FILE-PACKAGE
  - FLOW-RELEASE
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
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

## Mechanism

- **`prepack`/`postpack`** run `scripts/inject-platform-pins.mjs inject|restore`,
  writing pins version-matched to the root and removing them afterwards. Hooks
  log to stderr — `verify-pack` parses `npm pack --json` stdout.
- **Directory publish is refused.** `npm publish <dir>` packs (firing the hooks)
  then *re-reads `package.json` from disk* for the registry metadata — after
  `postpack` stripped the pins — so the packument has no optionalDependencies
  and installs a CLI shim with no binary (the 0.3.0 failure). For a file spec
  npm reads the manifest from the tarball. `prepublishOnly` runs
  `refuse-directory-publish.mjs`, which always fails; npm fires that hook only
  for a directory publish. Publish with
  `npm publish ./magic-spells-puzzle-<version>.tgz --access public`, platform
  packages first, root last. Platform packages are plain directory publishes
  (nothing injected).

## What `release:prep` enforces (`scripts/release-prep.mjs`)

- Step 0: `inject-platform-pins.mjs restore` first, so an aborted pack (npm skips
  `postpack` when the pack fails) can't feed a pinned manifest into a release.
- `verify-pack` packs a **real tarball** into a temp dir and checks: the
  tarball's `package/package.json` has exactly the expected pins, each `===` the
  root version; the `tar -tzf` file list passes the allowlist/required checks;
  the repo manifest is clean after packing (postpack ran); and the committed
  manifest (`git show HEAD:./package.json` — the bare `HEAD:package.json` form
  resolves from the monorepo top) has no optionalDependencies. Its expected pin
  list is compared by contents against the injector's.
- Every platform package is dry-packed and its declared binary must be present
  and non-empty (four of five binaries are cross-compiled and never executed on
  the release host).
- Step 6 packs the root tarball and reads every pin back out of the packed
  bytes; the expected set derives from the build matrix.

## After publishing: `npm run verify:published [-- <version>]`

Reads the packument (pins, version match, each pinned platform version exists,
`bin.puzzle`), checks `@magic-spells/puzzle-pieces` exists at the exact framework
version and the installed CLI resolves `add piece` to it (with
`PUZZLE_PIECES_REGISTRY` removed), then installs the published version into a
temp dir and runs `puzzle --version`. `verify:pack` proves the artifact;
`verify:published` proves the release — both are required. `e2e-pack.mjs` can't
catch a missing binary (platform packages are unpublished when it runs). Pure
predicates live in `scripts/release-checks.mjs` (unit-tested), because the
top-level scripts exit on import.

## Gotchas

- `restore` deletes `optionalDependencies` unconditionally — correct only while
  every optional dep is pack-time injected.
- Packing from a staged copy (never touching the worktree manifest) would be
  correct by construction; deferred as a tooling rewrite.
