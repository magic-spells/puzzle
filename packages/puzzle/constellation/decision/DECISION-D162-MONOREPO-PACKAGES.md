---
name: D162 — Monorepo packages/ — lockstep satellites live in the framework repo
status: verified
connections:
  - DECISION-D32-CLI-TOOLING
  - DECISION-D100-DEVTOOLS-BRIDGE
  - DECISION-D120-TARBALL-PUBLISH
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-23T23:41:18.496Z'
verified_sha: 1d9ce9fa1a905467382cdc0ef8f43e9f1993ea99
---

## Context

Separate satellite repos manufactured coordination work and failed at it: pieces had an unenforced "publish at or before the CLI" rule, the devtools panel broke against a framework release with no suite noticing, the lint/format plugins fell a grammar generation behind, and everything ran on hand-rolled workspace substitutes.

## Decision

The repo root is a **private shell** (`"name": "puzzle"`, `private: true`, `0.0.0`, never published) whose scripts delegate into `packages/puzzle`. Everything that versions in lockstep lives under `packages/`, and every npm package in the train carries the framework version (`release:prep` asserts the stamps):

- **`packages/puzzle`** — `@magic-spells/puzzle`: runtime, Go compiler, CLI, examples, release scripts, this constellation. Go module path `github.com/magic-spells/puzzle` is declared, not path-derived. The whole pack/release pipeline (pin injection, `verify:pack`, tarball-only publish, D120) runs from this directory.
- **`packages/puzzle-lang`** — the language as its own Go module, `github.com/magic-spells/puzzle/packages/puzzle-lang` (D172): `parser` plus the shared `jsident`/`textutil` helpers. This path IS directory-derived. The compiler requires it at `v0.0.0` with `replace => ../puzzle-lang`; outside consumers need a hand-made `packages/puzzle-lang/vX.Y.Z` tag. Not an npm package; `release:prep` doesn't stamp it.
- **`packages/puzzle-pieces`** — the pieces registry, demo and its own constellation root. Version must equal the framework's (pieces resolve to the CLI's major.minor, D32); `release:prep` asserts package.json, demo/package.json and the demo badge, and prints the pieces publish (a directory publish — no pin injection). The demo depends on `file:../../puzzle` and runs the monorepo binary `../../puzzle/puzzle` (it sits outside the Go module, so `go run` can't work).
- **`packages/puzzle-devtools`** — the Chrome extension (D100), `private: true` forever; ships as a zip via `npm run build:compiler` then `scripts/build.mjs` (defaults to the monorepo binary). Its framework dep is `file:../puzzle`, and CI runs its suite unconditionally, so a breaking framework change fails the day it lands.
- **`packages/puzzle-eslint` / `packages/puzzle-prettier`** — the `.pzl` plugins. Both vendor JS ports of the `puzzle-lang/parser` splitter/lexer, so grammar changes must land in them too; CI runs their suites on every push.

No published-version range exists inside the train, so there is no release-window state where `npm ci` can't resolve.

**No npm workspaces.** Each package keeps its own install and lockfile; editing any package.json dependency means regenerating that lockfile or `npm ci` hard-fails.

**Runtime resolution.** `FindRuntime` (`compiler/internal/build/build.go`) walks ANCESTORS for the in-repo runtime, which serves apps under `packages/puzzle` (the examples); sibling packages resolve through their `file:` links via `FindInstalledRuntime`'s `node_modules` walk. Don't break either path.

**Editor grammars stay out** (puzzle-vscode / sublime / zed): separate repos, dev-installed per README and versioned independently; editor extension tooling keys on standalone repos and git tags, which would collide with this repo's release tags. The release checklist sweeps them.

**Archive, never delete** absorbed repos: npm metadata links to them, PR/issue history lives there, and an archived name can't be squatted.

## Alternatives

- Framework at the repo root, satellites under `packages/` — the published manifest at the root forces the no-workspaces rule onto the whole repo, and the layout is asymmetric.
- Editor grammars in the monorepo — their tooling is repo- and tag-shaped; moving only vscode splits one family across two workflows.
- npm workspaces — hoisting is a new variable the release pipeline doesn't need.

## Consequences

Co-location, `release:prep` asserts and unconditional CI make train consistency a machine-checked property of one branch. The Go floor is 1.24 (binaries built earlier lack `LC_UUID` and are aborted by dyld on current macOS).
