---
name: Release flow
status: verified
triggers:
  - kind: manual
connections:
  - DECISION-D116-PACK-TIME-PIN-INJECTION
  - DECISION-D120-TARBALL-PUBLISH
  - DECISION-D100-DEVTOOLS-BRIDGE
  - DECISION-D32-CLI-TOOLING
  - FILE-PACKAGE
  - FILE-DEVTOOLS
  - FILE-SCAFFOLD
  - FILE-PIECES
  - DOC-RELEASE-SURFACE
  - COMPONENT-COMPILER-CLI
  - FEATURE-V1-32-RELEASE-HARDENING
  - FLOW-BUILD
  - RELEASE-V0-3-0
  - RELEASE-V0-3-1
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

# Release flow

Publishing Puzzle means publishing **six** npm packages by hand from one
machine: the root `@magic-spells/puzzle` plus the five
`@magic-spells/puzzle-<platform>-<arch>` packages carrying the compiled Go CLI
(macOS and Linux on arm64/x64, and Windows on x64 — Windows-on-ARM runs the x64
binary under emulation, so there is no `win32-arm64` package).
None of it is automated. The monorepo-root `.github/workflows/ci.yml` runs
eight jobs — the Go and JS suites, the Windows Go suite + CLI smoke,
`verify:pack`, `test:types`, the packed-tarball e2e, the browser smoke, and the
pieces/devtools/lint-plugin suites — on push and on pull requests for both
`main` and `release/**`, so a release branch is covered; it has no publish job,
and publishing is entirely by hand.

The order is not stylistic. Publish the root before its platform packages, or
publish it from the repo directory instead of from the packed tarball, and npm
accepts a release that installs cleanly with no working `puzzle` command behind
it ([[DECISION-D120-TARBALL-PUBLISH]]).

1. **Bump every place the version is written by hand** — this package's
   `package.json`, `compiler/internal/version/version.go`, the five
   `npm/puzzle-*/package.json` manifests, the `FRAMEWORK_VERSION` literal in
   `client-runtime/devtools.js`, and the eight monorepo train stamps
   (`puzzle-pieces` package + demo package + demo header badge,
   `puzzle-eslint`, `puzzle-prettier`, `puzzle-devtools` package + panel
   package + extension manifest); none derives from another, and
   `release:prep` asserts all of them.
   - `FRAMEWORK_VERSION` is a literal that **ships**: the ESM bundle cannot
     import `package.json`, and the value is reported to the DevTools extension
     ([[DECISION-D100-DEVTOOLS-BRIDGE]]). A comment asking the releaser to bump
     it was not enough, so `release:prep` asserts it.
2. **Point the `@magic-spells/puzzle` dependency ranges at the version being
   published** — the two scaffold manifests under
   `compiler/internal/scaffold/templates/` and every `examples/*/package.json`.
   These carry no version field of their own, so no bump touches them.
   - The scaffold manifests are `go:embed`ed into the CLI binary. A stale range
     ships a broken `puzzle init` that **no JS-only republish can repair** — the
     platform binaries have to be rebuilt. Caret ranges do not cross a 0.x
     minor, so `^0.6.0` installs `0.6.x` into an app scaffolded by a `0.7.0`
     binary. Leave each template's own `version` field alone; that is the
     scaffolded app's starting version, not Puzzle's.
3. **Write the release prose no script reads** — the CHANGELOG entry for this
   version and [[DOC-RELEASE-SURFACE]]. The README size banner is checked by a
   script (step 6) but written by hand.
4. **Run both suites** — `npx vitest run`, and `go test ./...` inside
   `compiler/`. `release:prep` prints this as a reminder and does not enforce
   it; CI runs both suites on every push to a `release/**` branch.
5. **Publish the matching `@magic-spells/puzzle-pieces` release**, at or before
   this one. `puzzle add piece` resolves pieces to the CLI's own major.minor
   ([[DECISION-D32-CLI-TOOLING]]), so a lagging pieces release silently drops
   zero-config `add piece` to an older minor — or hard-fails when none exists.
   - `PUZZLE_PIECES_REGISTRY` overrides the npm transport entirely. Unset it
     before smoke-testing the published path or the check proves nothing.
6. **Run `npm run release:prep`** — the only release pipeline there is, fail-fast
   at the first problem.
   - Restores `package.json` first: an aborted pack leaves the injected pins
     behind, because npm skips `postpack` when the pack step itself fails.
   - Asserts every hand-written version stamp agrees — those in this package
     plus the eight across the release train — and both range sweeps are clean.
   - Delegates to `verify:pack`, which packs a **real** tarball and reads the
     manifest and entry list back out of it.
   - Runs `measure-size --check`, which builds `examples/hello-world` and
     `examples/todos` in production and fails if the README's gzip figures no
     longer match.
   - Cross-compiles the five CLI binaries, copies `LICENSE.txt` beside each,
     and runs the host-platform binary's `--version`. The Windows target is
     the one whose output file is named `puzzle.exe`; every other target ships
     an extensionless `bin/puzzle`.
   - Packs the root tarball, reads every platform pin back out of the packed
     bytes, and prints the publish commands in the required order.
7. **Publish the five platform packages first**, as ordinary directory
   publishes. They declare no injected dependencies, so nothing is stripped from
   under them.
8. **Publish the root LAST, as the packed tarball `release:prep` named**, from
   `packages/puzzle` where it was packed —
   `npm publish ./magic-spells-puzzle-<version>.tgz --access public`.
   - Never `npm publish` from the repo directory. `prepublishOnly` refuses that
     path outright, and npm runs `prepublishOnly` only for a directory publish,
     so the guard is unreachable from the correct path and can only fire on the
     broken one.
9. **Run `npm run verify:published`** — the only check in the repo that inspects
   the registry metadata npm actually resolves installs against, and the only
   one that installs the published version into a temp dir outside the repo and
   runs `puzzle --version`.
10. **Hand the release off.** Cory creates the version tag and merges the
    release branch into `main`. An agent does neither, ever.

## Why the root goes last, and as a file

The platform pins do not live in the tracked manifest
([[DECISION-D116-PACK-TIME-PIN-INJECTION]]): between a version bump and the
publish those versions do not exist on the registry, which desyncs
`package-lock.json` and breaks `npm ci`. `prepack` injects them; `postpack`
removes them again.

A **directory** publish packs the tarball — firing both hooks — and then
re-reads `package.json` from disk to build the registry metadata. By then
`postpack` has already stripped the pins. The uploaded tarball is pin-perfect
while the packument declares no `optionalDependencies` at all, and npm resolves
installs from the packument, not the tarball. Publishing the **file** makes npm
read the manifest out of the tarball instead.

Ordering is the same resolution problem seen from the other side: an
`optionalDependency` naming a version that does not exist on the registry fails
**silently**, and from an installer's view that is indistinguishable from no pin
at all. The platform packages must already be published when the root's metadata
lands.

## What each check can and cannot prove

- `verify:pack` proves the **artifact** — that the bytes npm produced carry the
  right pins and only the runtime, the declarations and the bin shim. It also
  asserts the working-tree manifest is pin-free before AND after packing, which
  is the regression test for a `postpack` that never ran, and that the
  **committed** manifest is pin-free too — read as `git show HEAD:./package.json`
  with cwd at this package, because a bare `HEAD:package.json` resolves from the
  monorepo top and would silently inspect the private root shell instead.
- `e2e-pack` proves the **runtime resolves** from a real install. It runs while
  the platform packages are deliberately unpublished, so it can never catch a
  missing binary.
- The Windows CI job proves the **win32-x64 target is real**: it runs the Go
  suite on `windows-latest` and then scaffolds and builds an app with a freshly
  built `puzzle.exe`. Nothing in the release pipeline itself executes a
  cross-compiled binary for a platform other than the host — step 6's smoke test
  can only run the host's — so that job is the only standing proof the Windows
  binary works at all.
- `verify:published` proves the **release**. It is the only one that runs after
  publishing, and the only one that answers whether someone installing right now
  gets a CLI that runs.

A correct tarball is not evidence that a release is installable. Every check in
the pipeline was green for the release that shipped with no working binary,
because every check was looking at the tarball.

## Failure contract

A bad release cannot be repaired in place — a published version's metadata is
immutable and npm resolves from it. The fix is to bump past it, republish, and
deprecate the broken version; never to unpublish or re-upload.

`release:prep` is fail-fast and idempotent: it writes nothing a re-run will not
redo, so an aborted run is recovered by running it again. The one piece of state
an abort can leave behind is the injected pins in `package.json`, which is
exactly why the restore is step zero rather than a cleanup.
