---
name: Release flow
status: verified
triggers:
  - kind: manual
connections:
  - DECISION-D120-TARBALL-PUBLISH
  - DECISION-D100-DEVTOOLS-BRIDGE
  - DECISION-D32-CLI-TOOLING
  - DECISION-D128-BENCHMARK-METHODOLOGY
  - FILE-PACKAGE
  - FILE-DEVTOOLS
  - FILE-SCAFFOLD
  - FILE-PIECES
  - DOC-RELEASE-SURFACE
  - COMPONENT-COMPILER-CLI
  - FLOW-BUILD
verified_at: '2026-11-01T19:26:04.240Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Release flow

Publishing is by hand from one machine, run in `packages/puzzle` (the monorepo root's
`release:prep`/`verify:*` scripts delegate here). Cory publishes and tags; agents prepare
everything up to step 7 and never publish, tag, or merge to `main`. CI
(`.github/workflows/ci.yml`, push + PR on `main` and `release/**`) has no publish job.

Seven npm publishes: five `@magic-spells/puzzle-<platform>-<arch>` CLI packages
(macOS/Linux arm64+x64, Windows x64), `@magic-spells/puzzle-pieces`, and the root
`@magic-spells/puzzle`. There is no `win32-arm64` package: `bin/puzzle.js` and
`platformPackageNameFor` (`compiler/cmd/puzzle/upgrade.go`) fold a win32-arm64 host onto
the x64 package, whose `cpu` also lists `arm64` — all three must agree.

**Order is load-bearing**: platform packages first, pieces at or before the root, root last
and as the packed FILE ([[DECISION-D120-TARBALL-PUBLISH]]). Otherwise npm accepts a release
that installs with no working `puzzle` behind it.

1. **Bump every version stamp**: `package.json`, `compiler/internal/version/version.go`,
   the five `npm/puzzle-*/package.json`, the `FRAMEWORK_VERSION` literal in
   `client-runtime/devtools.js` (it SHIPS and is reported to the DevTools extension,
   [[DECISION-D100-DEVTOOLS-BRIDGE]]), the README status line, and the train stamps
   (pieces package + demo package + demo header badge, eslint, prettier, devtools package +
   panel + extension manifest). Do not add `optionalDependencies` to the tracked manifest.
2. **Sweep the `@magic-spells/puzzle` ranges** in
   `compiler/internal/scaffold/templates/*/package.json` and `examples/*/package.json`
   (`rg -n '"@magic-spells/puzzle":' …`). The scaffold manifests are `go:embed`ed: a stale
   range ships a broken `puzzle init` that only rebuilt binaries can fix (carets don't
   cross a 0.x minor). Leave each template's own `version` alone.
3. **Write the prose no script reads**: the CHANGELOG entry and [[DOC-RELEASE-SURFACE]].
   The README size banner is hand-edited but script-checked (step 6); regenerate figures
   with `npm run measure:size`.
4. **Run the suites**: `npx vitest run`, `npm run test:runtime-types`, `go test ./...` in
   `compiler/` and in `../puzzle-lang`. `release:prep` does not run the Go or vitest
   suites.
5. **Snapshot the benchmark** on a committed clean tree, same machine and browser as
   earlier snapshots: `npm run bench:update`, then `npm run bench:snapshot` (writes
   `benchmarks/history/<version>.json`; refuses a baseline measured on a dirty tree;
   `bench:history` warns when machine/browser differ). Commit `benchmarks/baseline.json`
   and the history file ([[DECISION-D128-BENCHMARK-METHODOLOGY]]).
6. **`npm run release:prep`** (`scripts/release-prep.mjs`, fail-fast, idempotent):
   - restores `package.json` first (an aborted pack skips `postpack` and leaves injected pins);
   - asserts every stamp from step 1 and both range sweeps from step 2;
   - runs `verify:pack` on a real tarball;
   - runs `measure-size --check` (production builds of hello-world and todos vs. the README
     figures);
   - runs `test:runtime-types`;
   - cross-compiles the five binaries (`-trimpath`, version via `-ldflags`, `puzzle.exe` on
     Windows) with `LICENSE.txt`, **dry-packs each platform package** asserting its declared
     binary is inside at non-zero size, and runs the host binary's `--version`;
   - packs the root, reads the pins back out of the packed bytes, and prints the publish
     commands in order plus the tag reminder. It never publishes, tags or pushes.
7. **Publish the five platform packages** (`npm publish ./npm/<pkg> --access public`;
   directory publishes are fine for them), then **pieces** (`npm publish ../puzzle-pieces
   --access public`) — `add piece` resolves to the CLI's major.minor
   ([[DECISION-D32-CLI-TOOLING]]).
8. **Publish the root last, as the tarball**:
   `npm publish ./magic-spells-puzzle-<version>.tgz --access public`. `prepublishOnly`
   refuses a directory publish (npm only runs it for directory publishes, so it fires only
   on the broken path).
9. **`npm run verify:published`**: the root version and its packument's exact platform
   pins exist, each pinned platform version exists, the `puzzle` bin is declared, a real
   temp-dir install runs `puzzle --version`, puzzle-pieces exists at the EXACT version, and
   a scaffolded app's `add piece` resolves to it (read from `pieces.lock`,
   `PUZZLE_PIECES_REGISTRY` deleted from the child env, fallback notice = failure).
10. **Hand off to Cory**: the `vX.Y.Z` tag AND the companion `packages/puzzle-lang/vX.Y.Z`
    tag (Go resolves subdirectory modules only through prefixed tags), the merge into
    `main`, and the devtools zip (`npm run build:compiler`, then `npm run build:zip` in
    `../puzzle-devtools`), which is separate and unhurried.

## Why the root goes last, as a file

Platform pins are not in the tracked manifest — unpublished versions would break `npm ci`
— so `prepack` injects and `postpack` strips them (`scripts/inject-platform-pins.mjs`). A
directory publish re-reads `package.json` AFTER `postpack`, so the packument declares no
`optionalDependencies` even though the tarball has them, and npm resolves from the
packument. Publishing the file makes npm read the tarball's manifest. An
`optionalDependency` naming an unpublished version fails silently, so platforms must exist
first.

## What each check proves

- `verify:pack` — the artifact: correct pins, only runtime + declarations + bin shim (plus
  README/LICENSE/CHANGELOG); working-tree manifest pin-free before and after packing;
  committed manifest pin-free (`git show HEAD:./package.json` with cwd here — a bare
  `HEAD:package.json` reads the monorepo root shell).
- `e2e-pack` — the runtime resolves from a real install (platforms unpublished, so it can't
  catch a missing binary).
- Platform dry-pack — each package contains a binary (not that it runs).
- Windows CI job — the only standing proof the win32-x64 binary works (Go suite on
  `windows-latest` + scaffold and build with a fresh `puzzle.exe`).
- `verify:published` — the release itself, from registry metadata. Every tarball check can
  be green for a release that installs with no working binary.

## Failure contract

Published metadata is immutable: bump past a bad release, republish, deprecate — never
unpublish or re-upload. `release:prep` writes nothing a re-run won't redo; the only state
an abort leaves is injected pins, hence the restore runs first. Never recommend a
deprecated broken version (0.3.0).
