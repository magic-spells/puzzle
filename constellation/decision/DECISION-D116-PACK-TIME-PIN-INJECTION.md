---
name: >-
  D116 — platform pins are injected at pack time, and verify-pack inspects the real tarball, not
  the injection function
status: verified
connections:
  - FEATURE-V1-32-RELEASE-HARDENING
  - FILE-PACKAGE
verified_at: '2026-08-16T04:34:44.770Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
notes:
  - kind: verified
    text: >-
      verify-pack real-tarball rework + release:prep restore-first landed; negative tests proved the
      old check passed under --ignore-scripts and a broken postpack
    sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

The four `@magic-spells/puzzle-<platform>-<arch>` optionalDependencies do not
live in the tracked manifest. `scripts/inject-platform-pins.mjs` writes them —
version-matched to the root — in `prepack` and removes them in `postpack`, and
`scripts/verify-pack.mjs` validates the mechanism by packing a **real tarball**
and reading what actually ships.

## Context

Between a version bump and the publish, pinned versions do not exist on the
registry, which desyncs `package-lock.json` and breaks `npm ci`. So the pins
moved out of the tracked manifest into the pack-time hooks. Two problems rode
along:

- `verify-pack` moved with them and validated `injectPins(pkg)` — the function
  under test used as its own oracle. The tarball's manifest was never read,
  and the file list came from `npm pack --dry-run`, which produces no tarball.
  Any publish path that skips prepack (`npm publish --ignore-scripts`, a
  republished tarball, a failed hook) would ship a manifest with **no**
  platform pins — `npx puzzle` broken for every installer — while
  `npm run verify:pack` printed PASS. The last guard before a hand-publish
  passed unconditionally.
- `prepack` rewrites the real, tracked `package.json`, and npm does not run
  `postpack` when the pack step itself fails (a `prepublishOnly` rejection, a
  Ctrl-C, a full disk). An aborted pack leaves the worktree pinned to
  registry-nonexistent versions — precisely the `npm ci` breakage the
  mechanism exists to prevent.

## Decision

- **verify-pack packs for real**: `npm pack --json --pack-destination` into a
  temp dir, then (1) the tarball's `package/package.json` must carry all four
  pins `===` the root version and nothing else in `optionalDependencies`;
  (2) the packed file list comes from `tar -tzf`, fed to the same
  allowlist/REQUIRED checks as before; (3) after packing, the REPO manifest
  must be clean again — that is the postpack regression test; (4) the
  COMMITTED manifest (`git show HEAD:package.json`) must carry no
  `optionalDependencies`. This exercises prepack/postpack end to end and
  fails on a hook that didn't run, a pin that didn't match, or a leftover
  mutation.
- **`release:prep` runs `inject-platform-pins.mjs restore` as its first
  step**, so a previously-aborted pack can never feed a stale pinned manifest
  into a release.
- The repo-manifest-clean check still runs BEFORE packing too (better error
  than the tarball check when the worktree is already dirty with pins).

## Alternatives rejected / deferred

- **Packing from a staged copy** so the worktree manifest is never touched —
  correct by construction, but a release-tooling rewrite; deferred. The
  restore-first + verify-at-exit pair closes the practical window.
- **Keeping the pins tracked** — the original `npm ci` breakage; rejected when
  the mechanism was introduced.

## Gotchas

- `restore` deletes `optionalDependencies` unconditionally — correct only
  while ALL optional deps are pack-time-injected. The day a real optional
  dependency is added, the restore path must learn to preserve it (commented
  at the delete site).
- The hooks log to stderr because verify-pack parses `npm pack --json`
  stdout; anything that prints to stdout inside prepack/postpack corrupts the
  JSON payload.
