---
name: >-
  D120 — the root package is published as a packed tarball, because a directory publish sends a
  manifest with no platform pins
status: verified
connections:
  - DECISION-D116-PACK-TIME-PIN-INJECTION
  - FEATURE-V1-32-RELEASE-HARDENING
  - FILE-PACKAGE
verified_at: '2026-08-16T04:34:45.474Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
notes:
  - kind: verified
    text: >-
      Proven end-to-end by the 0.3.1 release. 0.3.0 (directory publish) shipped a pin-perfect
      tarball behind a packument with no optionalDependencies; 0.3.1 published as
      ./magic-spells-puzzle-0.3.1.tgz carried all four pins to the registry. `npm run
      verify:published` passed every step INCLUDING the real temp-dir install (`installed puzzle
      --version → puzzle version 0.3.1`), and its negative case was exercised against 0.3.0 (fails
      at the metadata step, exit 1) and its positive case against 0.2.0 (full pass incl. install).
      `npm publish --dry-run` from the repo directory is refused by the prepublishOnly guard. 0.3.0
      is deprecated on npm. Global install verified: /opt/homebrew/bin/puzzle → 0.3.1.
    sha: d6d6b659166337cc54e2909e116efce20faf45c7
---

`npm publish` is never run against the repo directory for the root package. The
release flow packs a tarball and publishes **that file**:

```
npm run release:prep                                   # packs + verifies the .tgz
npm publish ./magic-spells-puzzle-<version>.tgz --access public
```

`prepublishOnly` is wired to `scripts/refuse-directory-publish.mjs`, which fails
unconditionally — npm runs that hook only for a directory publish, so the hook
can only fire on the broken path. `scripts/verify-published.mjs`
(`npm run verify:published`) then asks the registry whether the published version
actually resolves a binary.

## Context

D116 moved the four platform pins out of the tracked manifest into `prepack` /
`postpack`, and hardened `verify-pack` to inspect a real tarball rather than the
injection function. Both of those are right, and neither catches this.

`npm publish` on a directory does not upload the manifest from the tarball it
just built. In `lib/commands/publish.js` (npm 11) it packs at roughly L111 —
firing `prepack` (inject) and `postpack` (restore) — and then **re-reads
`package.json` from disk** at roughly L124 to build the registry metadata. By
that point `postpack` has already stripped the pins. The tarball ships
pin-perfect; the packument declares no `optionalDependencies` at all.

npm resolves installs from the packument, not from the tarball. So 0.3.0
published a correct artifact that installs to a CLI shim with nothing behind it:

```
$ puzzle --version
puzzle: no prebuilt CLI binary available for this platform (darwin-arm64).
```

Every check in the pipeline passed, because every check was looking at the
tarball. 0.2.0 was immune only because its pins were still committed in the
tracked manifest — the pack-time injection landed after it shipped, making 0.3.0
the first release through the mechanism and the first to hit the defect.

## Decision

Publish the file. For a file spec npm reads the manifest out of the tarball, so
the injected pins reach the registry — verified against npm's own bundled pacote:

```
pacote.manifest('file:./magic-spells-puzzle-0.3.1.tgz')
  → optionalDependencies: { …all four at 0.3.1 }
```

Three changes enforce it:

- **`prepublishOnly` refuses.** The hook's directory-only firing rule is the
  whole mechanism: it is unreachable from a tarball publish, so an unconditional
  failure blocks exactly the wrong path and nothing else.
- **`release:prep` packs the artifact it names.** Step 6 packs the root tarball
  and reads the four pins back out of the packed bytes, so the filename printed
  in the summary is one whose manifest has been proven correct.
- **`verify:published` checks the registry after the fact, and then stops
  reasoning and installs.** It reads the packument — the pins, their version
  match, that each pinned platform version actually exists, `bin.puzzle` intact —
  and then installs the published version into a temp dir outside the repo and
  runs `puzzle --version`. The metadata checks give a precise diagnosis; the
  install is what actually answers the question, because 0.3.0 looked healthy
  from every angle except a real install. Takes an optional version argument
  (`npm run verify:published -- 0.3.0`), which is how its own negative case is
  exercised.

  No other check in the repo proves this. `scripts/e2e-pack.mjs` installs a packed
  tarball, but the platform packages are unpublished at that point, so it asserts
  the install *succeeds despite* unresolvable optional deps — it can never catch a
  missing binary. `verify:pack` inspects the artifact. Both were green for 0.3.0.

The platform packages are still plain directory publishes. They declare no
injected dependencies, so nothing is stripped from under them.

## Consequences



- 0.3.0 is permanently broken on npm and cannot be repaired in place; it is
  superseded by 0.3.1 and is deprecated rather than unpublished.
- `prepublishOnly` does not run `release-prep.mjs`. A tarball publish would not
  fire it anyway, so the pre-publish suite is explicitly a `npm run
  release:prep` step, not something a publish drags along behind it.
- The `go:embed`ed scaffold templates and the examples pin the version actually
  being published, so a fresh app can never resolve a release known to be
  broken — a caret range does not skip a bad patch on its own.
- A correct tarball is not sufficient evidence that a release is
  installable. `verify:pack` proves the artifact; `verify:published` proves the
  release. Both are required, and only the second one runs after publishing.
