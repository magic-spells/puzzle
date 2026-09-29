---
name: D169 — registry dependencies carry a version floor; `add piece` prints `name@range`
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - DECISION-D32-CLI-TOOLING
  - DECISION-D167-COMPONENT-FAMILIES
  - FILE-PIECES
---

# D169 — registry dependencies carry a version floor; `add piece` prints `name@range`

A piece manifest's `dependencies` entry is an npm install spec
(`"@magic-spells/collapsible-content@^1.2.0"`), and `puzzle add piece` prints it
verbatim: `npm install @magic-spells/collapsible-content@^1.2.0`.

## Context

The registry is copy-in (D3: the CLI prints, never runs, the install), so the
printed line is the only channel it has for telling an app what it needs. A bare
name makes npm install **latest**, which silently breaks a wrapper piece built
against a newer component (the accordion lost `<collapsible-group>` exclusivity
this way).

## Decision

- **An entry is `"<package>[@<range>]"`**; the range is the semver FLOOR the
  piece was built against, in any form npm accepts, passed through verbatim
  (parsed only to compare floors).
- **A bare name means "any version"** — third-party registries keep working;
  `registry.json` stays `"version": 1`.
- **The printed line merges by package name, highest floor wins** (a bare name
  loses to any floor), sorted by name, one `npm install` line.
- **The line is unconditional** — the CLI never reads the app's `package.json`
  to suppress satisfied deps (a second, drift-prone source of truth).
- **`pieces.lock` does not record floors** — it records copied-byte hashes;
  a floor is the registry's claim, not an app fact.
- **Every dependency in this registry carries a floor equal to the version
  `packages/puzzle-pieces/demo/package.json` installs.**
  `test/registry-deps.test.js` fails on a bare entry, on two pieces disagreeing
  about a package, and on drift from the demo.

## Alternatives

- **Object map `{name: range}`** — changes the Go field type and forces
  accepting two shapes for bare-name registries; the string form is what npm
  and shadcn speak.
- **Exact pins** — the user owns copied source; the failure is resolving too
  low, not too high.
- **`add piece` runs the install** — D3.
- **Lockstep components with the framework version** — the web components are
  independent packages on their own release lines.

## Consequences

- `compiler/internal/pieces/deps.go` owns spec splitting and floor comparison
  (numeric semver core, prereleases below their release, unreadable ranges
  compared lexically for determinism); `collectNpmDeps` keys by package name.
- Wrapping a web component requires it to be **published** at the wrapped
  version. Bumping a component in `demo/package.json` means moving the
  manifests with it, or the pieces suite fails.
- The pieces plan's `DOC-REGISTRY` (`packages/puzzle-pieces`) carries the
  manifest-side rule; the two plans are not card-connected.
