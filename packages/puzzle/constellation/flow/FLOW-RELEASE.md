---
name: Release flow
status: verified
triggers:
  - kind: manual
connections:
  - DECISION-D120-TARBALL-PUBLISH
  - DECISION-D100-DEVTOOLS-BRIDGE
  - DECISION-D32-CLI-TOOLING
  - FILE-PACKAGE
  - FILE-DEVTOOLS
  - FILE-SCAFFOLD
  - FILE-PIECES
  - DOC-RELEASE-SURFACE
  - COMPONENT-COMPILER-CLI
  - FLOW-BUILD
  - RELEASE-V0-3-0
  - RELEASE-V0-3-1
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: decision
    text: >-
      Per-release benchmark snapshot (added 0.8.0, PR #200). Between step 4 (suites) and step 6
      (release:prep), on a committed clean tree, run `npm run bench:update` then `npm run
      bench:snapshot` in packages/puzzle, and commit both benchmarks/baseline.json and
      benchmarks/history/<version>.json. bench:snapshot refuses a baseline measured on a dirty tree.
      Measure on the same machine and browser as the earlier snapshots, or the history rows are not
      comparable (`npm run bench:history` warns when meta.machine/browser differ). The history
      starts with 0.6.0 and 0.7.0, backfilled 2026-09-30 with each tag's own harness. Why: Cory
      wanted performance tracked across releases. The step is mechanical and costs no agent tokens.
    sha: b135fde1
---

# Release flow

Publishing is by hand from one machine: **six** npm packages — root
`@magic-spells/puzzle` plus five `@magic-spells/puzzle-<platform>-<arch>` CLI packages
(macOS/Linux arm64+x64, Windows x64). There is no `win32-arm64` package: `bin/puzzle.js`
and `platformPackageNameFor` (`compiler/cmd/puzzle/upgrade.go`) map a win32-arm64 host to
the x64 package, whose `cpu` also lists `arm64` — all three are needed. CI
(`.github/workflows/ci.yml`, push + PR on `main` and `release/**`) has no publish job.

**Order is load-bearing**: platform packages first, root last, root as the packed FILE
([[DECISION-D120-TARBALL-PUBLISH]]). Otherwise npm accepts a release that installs with no
working `puzzle` behind it.

1. **Bump every hand-written version stamp**: `package.json`,
   `compiler/internal/version/version.go`, the five `npm/puzzle-*/package.json`, the
   `FRAMEWORK_VERSION` literal in `client-runtime/devtools.js` (it SHIPS and is reported to
   the DevTools extension, [[DECISION-D100-DEVTOOLS-BRIDGE]]), and the train stamps
   (pieces package + demo package + demo header badge, eslint, prettier, devtools package +
   panel + extension manifest). `release:prep` asserts them all.
2. **Sweep the `@magic-spells/puzzle` ranges** in `compiler/internal/scaffold/templates/*`
   and `examples/*/package.json`. The scaffold manifests are `go:embed`ed: a stale range
   ships a broken `puzzle init` that only rebuilt binaries can fix (carets don't cross a
   0.x minor). Leave each template's own `version` alone.
3. **Write the prose no script reads**: the CHANGELOG entry and [[DOC-RELEASE-SURFACE]].
   The README size banner is hand-written but script-checked (step 6).
4. **Run the suites**: `npx vitest run`, `go test ./...` in `compiler/` and in
   `../puzzle-lang` (not enforced by `release:prep`; CI runs them).
5. **Publish the matching `@magic-spells/puzzle-pieces`** at or before this release —
   `add piece` resolves to the CLI's major.minor ([[DECISION-D32-CLI-TOOLING]]). Unset
   `PUZZLE_PIECES_REGISTRY` (set in the maintainer's shell) before smoke-testing.
6. **`npm run release:prep`** (fail-fast, idempotent): restores `package.json` first (an
   aborted pack skips `postpack` and leaves injected pins); asserts every stamp and both
   range sweeps; runs `verify:pack` on a real tarball; runs `measure-size --check`
   (production builds of hello-world and todos vs. the README figures); cross-compiles the
   five binaries (`puzzle.exe` on Windows, `bin/puzzle` elsewhere) with `LICENSE.txt`,
   runs the host binary's `--version`; **dry-packs all five platform packages** and
   asserts each contains its declared binary at non-zero size; packs the root, reads the
   pins back out of the packed bytes, and prints the publish commands in order.
7. **Publish the five platform packages** (directory publishes are fine for them).
8. **Publish the root last, as the tarball**, from `packages/puzzle`:
   `npm publish ./magic-spells-puzzle-<version>.tgz --access public`. `prepublishOnly`
   refuses a directory publish (npm only runs it for directory publishes, so it can only
   fire on the broken path).
9. **`npm run verify:published`**: checks the registry packument, installs into a temp dir
   outside the repo and runs `puzzle --version`, requires puzzle-pieces at the EXACT
   version, and scaffolds an app whose `add piece` must resolve to it (read back from
   `pieces.lock`, `PUZZLE_PIECES_REGISTRY` deleted, fallback notice = failure).
10. **Hand off**: Cory creates the `vX.Y.Z` tag AND the companion
    `packages/puzzle-lang/vX.Y.Z` tag (Go resolves subdirectory modules only through
    prefixed tags), and merges the release branch into `main`. Agents never do either.

## Why the root goes last, as a file

Platform pins are not in the tracked manifest ([[DECISION-D120-TARBALL-PUBLISH]]) —
unpublished versions would break `npm ci` — so `prepack` injects and `postpack` strips
them (`scripts/inject-platform-pins.mjs`). A directory publish re-reads `package.json`
AFTER `postpack`, so the packument declares no `optionalDependencies` even though the
tarball has them, and npm resolves from the packument. Publishing the file makes npm read
the tarball's manifest. And an `optionalDependency` naming an unpublished version fails
silently, so platforms must exist first.

## What each check proves

- `verify:pack` — the artifact: correct pins, only runtime + declarations + bin shim;
  working-tree manifest pin-free before and after packing; committed manifest pin-free
  (`git show HEAD:./package.json` with cwd here — a bare `HEAD:package.json` reads the
  monorepo root shell).
- `e2e-pack` — the runtime resolves from a real install (platforms unpublished, so it
  can't catch a missing binary).
- Platform dry-pack — each package contains a binary (not that it runs).
- Windows CI job — the only standing proof the win32-x64 binary works (Go suite on
  `windows-latest` + scaffold and build with a fresh `puzzle.exe`).
- `verify:published` — the release itself. Every other check was green for the release
  that shipped with no working binary, because they all looked at the tarball.

## Failure contract

Published metadata is immutable: bump past a bad release, republish, deprecate — never
unpublish or re-upload. `release:prep` writes nothing a re-run won't redo; the only state
an abort leaves is injected pins, hence the restore runs first.
