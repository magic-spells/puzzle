---
name: D162 — Monorepo packages/ — lockstep satellites live in the framework repo
status: verified
connections:
  - DECISION-D32-CLI-TOOLING
  - DECISION-D100-DEVTOOLS-BRIDGE
  - DECISION-D120-TARBALL-PUBLISH
  - DOC-RELEASE-SURFACE
notes:
  - kind: gotcha
    text: >-
      There are deliberately NO npm workspaces: each package keeps its own install and
      lockfile, so editing any package.json dependency means regenerating that package's
      lockfile or its `npm ci` hard-fails. Runtime resolution for sibling packages: the
      compiler's in-repo walk (FindRuntime, compiler/internal/build/options.go) checks
      ANCESTORS only, so it serves apps under packages/puzzle (the examples); the sibling
      packages (pieces demo, devtools) resolve through their file: links via the
      node_modules walk (FindInstalledRuntime) — do not break either path. The pack
      pipeline (pin injection, verify:pack, tarball-only publish, D120) runs unchanged
      inside packages/puzzle; the root shell only delegates.
  - kind: verified
    text: >-
      Merged to release/0.7.0 via PR #79 at c911154. Every Decision claim checked live: both subtree
      imports carry full history (pieces @ 51d2403, devtools @ 60706aa); root suites unchanged
      post-import (1742 vitest, go test, verify:pack — 57 tarball files, no packages/ leak;
      test:types); pieces 85/85 + demo built by the in-repo CLI; devtools 271/271 against the
      in-progress 0.7.0 runtime with the panel compiled through build.mjs's monorepo-binary default.
      release:prep train asserts and publish-order lines exercised by parse + review,
      fire-at-release by design (root still 0.6.0 mid-flight). Push-protection footnote: the
      imported pieces history carries a fabricated sk_live_-shaped doc sample in old commits/bundles
      — allowed once as a false positive; the live tree now says testKey, so the detector can never
      re-fire on new content.
    sha: c9111541b03cb8ee4528617cabddb8b92ed58a67
verified_at: '2026-08-23T22:54:51.948Z'
verified_sha: c9111541b03cb8ee4528617cabddb8b92ed58a67
---
# D162 — Monorepo `packages/`: one repo, one release train

## Decision

The repo root is a **private shell** (named plain `puzzle`, `private: true`,
version 0.0.0, never published) whose scripts delegate into the framework
package. Everything that versions in lockstep lives under `packages/`, and
every package in the train carries the framework's version:

- **`packages/puzzle`** — the framework itself: `@magic-spells/puzzle`
  (runtime, Go compiler, CLI, examples, release scripts, and this
  constellation). The Go module path is unchanged
  (`module github.com/magic-spells/puzzle` — declared, not path-derived), and
  the whole release pipeline runs from this directory exactly as it always
  has. The absorbed satellites were imported with full history
  (`git subtree add`); the framework itself moved here by `git mv`, so
  `git log --follow` crosses the move.
- **`packages/puzzle-pieces`** — the `@magic-spells/puzzle-pieces` npm
  transport: registry, node test suites, demo app, and its own constellation
  root. Pieces resolve to the CLI's major.minor (D32), so the version must
  equal the framework's exactly; `release:prep` asserts package.json,
  demo/package.json, and the demo header badge, and prints the pieces publish
  in the release order — a directory publish, safe here because pieces has no
  pin injection. Published versions carry
  `repository.directory: "packages/puzzle-pieces"`.
- **`packages/puzzle-devtools`** — the Chrome DevTools extension (D100). Its
  `@magic-spells/puzzle` dependency is a `file:../puzzle` link, so the vitest
  suite and panel build always run against the working-tree runtime; CI runs
  the suite unconditionally, so a framework breaking change fails the build
  the day it lands. `private: true` forever — "publishing" is always the
  extension zip (`npm run build:compiler`, then `build.mjs`, which defaults
  to the monorepo binary `../puzzle/puzzle`), never npm.
- **`packages/puzzle-eslint` / `packages/puzzle-prettier`** — the `.pzl`
  lint/format plugins (`@magic-spells/eslint-plugin-puzzle`,
  `@magic-spells/prettier-plugin-puzzle`). Both vendor JS ports of the
  compiler's section splitter/lexer, so grammar changes must land in them
  too — CI runs their suites on every push. Train-versioned and
  release-prep-asserted; their first npm publish is a separate decision.

The pieces demo's framework dep is `file:../../puzzle` and its scripts run
the monorepo compiler binary (`../../puzzle/puzzle` — `go run` needs module
context, and the demo sits outside the Go module). No published-version range
exists inside the train, so there is no release-window state where `npm ci`
cannot resolve.

**What stays out.** The three editor grammars (puzzle-vscode / puzzle-sublime
/ puzzle-zed) stay in separate repos: their distribution channels are
repo-shaped — Zed's extension registry submodules the extension repo and pins
the grammar by repo+commit, and Package Control reads git tags as versions,
which would collide with this repo's release tags. Their forcing function is
the release checklist sweep (and the grammar repos' example parse-sweeps),
not co-location.

**Archive, never delete.** Absorbed repos are archived on GitHub after a
final pointer-README commit: published npm metadata links to them, PR/issue
history lives only in GitHub's copy, and an archived name cannot be squatted.

## Why

The separate repos manufactured coordination work and then failed at it:
pieces publishing had a timing rule ("at or before the CLI release, or
zero-config `add piece` breaks") enforced by nothing; the devtools panel sat
hard-broken against a framework release for a week because no suite ran when
the framework moved; the lint/format plugins sat a full grammar generation
behind with zero commits; and the satellites ran on hand-rolled workspace
substitutes (a `PUZZLE_PIECES_REGISTRY` shell override, a hand-made
`node_modules` symlink). Co-location plus `release:prep` asserts plus
unconditional CI turns all of that into machine-checked properties of one
branch. The private-shell root keeps the published
manifest inside the package that owns it, so the delicate pack pipeline never
interacts with repo-level tooling.

## Alternatives rejected

- **Framework at the repo root, satellites under `packages/`** — keeps the
  published manifest at the repo root, which forces the no-workspaces
  rationale onto the whole repo and leaves the layout asymmetric (four
  packages down, one up). The uniform shape costs only path churn, all of it
  verifiable by the existing suites and a full `release:prep` dry run.
- **Grammars in the monorepo too** — npm-distributed packages don't care
  where they live, but Zed and Sublime distribution is keyed to standalone
  repos and tag namespaces; two of three grammars can't move, and moving only
  vscode would split one uniform family across two workflows.
- **npm workspaces** — see the note; per-package installs are self-contained
  and already proven, and hoisting is a new variable the release pipeline
  does not need.
- **Keeping the pieces GitHub Pages demo deploy** — the site's
  `/puzzle-pieces` page is the live catalog; a second deployment of the same
  content from CI is maintenance with no audience. The archived repo keeps
  serving its last deploy until taken down.
