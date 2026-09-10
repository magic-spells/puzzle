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

A piece manifest's `dependencies` entry is an npm **install spec**, not a bare
package name:

```json
"dependencies": ["@magic-spells/collapsible-content@^1.2.0"]
```

and `puzzle add piece` prints it verbatim:

```
$ npm install @magic-spells/collapsible-content@^1.2.0
```

## Context

`piece.json` / `registry.json` listed bare package names, and the CLI printed
`npm install <name>` — which npm resolves to **latest**. That is fine only while
the registry and the components move together, and the D167 wrapper families
broke that assumption: they were authored against component versions that were
still unpublished, so on the 0.7.0 registry `puzzle add piece accordion` printed
`npm install @magic-spells/collapsible-content`, npm installed the published
1.1.1, and the accordion came up with no `<collapsible-group>` — exclusivity
silently gone, no error anywhere. Any future component bump can do the same to
any wrapper piece: the registry knew which version it was built against and had
nowhere to say so.

The pieces registry is a **copy-in** registry (D3: the CLI prints, never runs,
the install), so the printed line is the only channel the registry has for
telling an app what it needs. It had better be exact.

## Decision

- **A `dependencies` entry is `"<package>[@<range>]"`.** The range is the semver
  FLOOR the piece was built against, in whatever form npm accepts after the `@`
  (`^1.2.0`, an exact pin, a compound range). It is passed through verbatim —
  the compiler parses it only to compare two floors, never to rewrite one.
- **A bare name still means "any version".** Third-party registries written
  against the pre-0.7.1 schema keep resolving and keep printing bare. There is
  no schema version bump: `registry.json`'s `"version": 1` is unchanged, because
  an old CLI reading a floored manifest and an old manifest read by a new CLI
  both behave sensibly.
- **The printed line merges by package NAME with the highest floor winning.**
  `add piece sheet dialog` resolves two pieces that both need
  `@magic-spells/dialog-panel`; the app must satisfy every piece it just copied,
  so the strictest floor is the only correct one to print. A bare name loses to
  any floor. Entries are sorted by package name, one `npm install` line.
- **The line is unconditional.** The CLI does not read the app's `package.json`
  to suppress a dependency already installed at a satisfying range. Re-running
  an install npm already satisfies is a no-op, whereas parsing the app manifest
  to decide would put a second, drift-prone source of truth in the path of the
  one thing the user has to do by hand.
- **`pieces.lock` does not record floors.** The lock records the sha256 of every
  copied byte so a future `diff`/`update` can tell upstream drift from local
  edits; a floor is neither copied nor an app fact. It would be a duplicate of
  the registry's claim, stale the moment the registry moves.
- **Every `@magic-spells/*` and third-party dependency in this registry carries
  a floor**, equal to the version `packages/puzzle-pieces/demo/package.json`
  installs — the demo is what exercises the wrappers, so a floor above it would
  be a claim nothing has tested. `test/registry-deps.test.js` fails on a bare
  entry, on two pieces disagreeing about a package, and on any drift from the
  demo.

## Alternatives

- **An object map — `{"@magic-spells/collapsible-content": "^1.2.0"}`** —
  rejected. It is a cleaner-looking schema but every consumer pays: the Go
  `Piece.Dependencies` field changes type, the registry aggregation stops being
  a pass-through, and supporting bare names (which we must, for third-party
  registries) means accepting BOTH shapes in one JSON field and branching on
  them. The string form makes a floorless entry the degenerate case of the
  floored one instead of a separate shape, and it is what npm itself, and
  shadcn's registry, already speak.
- **Pin exact versions instead of floors** — rejected: a piece is copy-in source
  the user then owns; forbidding them a patch upgrade of the component
  underneath it buys nothing. The failure being fixed is resolving too LOW.
- **Have `add piece` run the install** — rejected, D3: the CLI never runs npm or
  rewrites user-owned files.
- **Lockstep the components with the framework version** the way the registry
  package itself is (per-piece "requires pieces >= x") — rejected: the web
  components are independent packages on their own release lines, and a floor
  per dependency says exactly what is needed with no coordination cost.

## Consequences

- `compiler/internal/pieces/deps.go` owns spec splitting and floor comparison
  (numeric semver core, prereleases below their release, unreadable ranges
  compared lexically so the merge stays deterministic); `collectNpmDeps` keys by
  package name instead of by whole string.
- Wrapping a web component now requires it to be **published** at the version
  being wrapped — an unpublished bump cannot be a floor. That closes the
  "PUBLISHED UPSTREAM" gap the pieces `DECISION-WRAP-WEB-COMPONENTS` card
  recorded: it said an unpublished component cannot be wrapped, but nothing
  enforced which published version an app would get.
- Bumping a component in `demo/package.json` is now a two-file change: the
  manifests move with it, or the pieces suite fails.
- The pieces `DOC-REGISTRY` card (separate plan, `packages/puzzle-pieces`)
  carries the manifest-side rule; the two repos are not card-connected.
