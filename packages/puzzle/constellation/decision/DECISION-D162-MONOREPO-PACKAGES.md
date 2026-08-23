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
      There are deliberately NO npm workspaces at the root: the root package.json IS the published
      @magic-spells/puzzle, and the pack pipeline (pin injection, verify:pack, tarball-only publish,
      D120) must not change shape. Each package keeps its own npm install and lockfile. Stage 2
      (framework → packages/puzzle under a private workspace root, the full Embla/tarot shape) is a
      separate future chore — and note the compiler's in-repo walk (FindRuntime,
      compiler/internal/build/options.go) checks ANCESTORS only: it is what resolves
      '@magic-spells/puzzle' for apps under packages/ today, and moving the framework out of the
      ancestor chain breaks it without new resolution work.
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

# D162 — Monorepo `packages/`: lockstep satellites live in the framework repo

## Decision

Packages that version in lockstep with the framework live in this repo under
`packages/`, imported with full history (`git subtree add`), and every package
in the release train carries the root version:

- **`packages/puzzle-pieces`** — the `@magic-spells/puzzle-pieces` npm
  transport: registry, node test suites, demo app, and its own constellation
  (`packages/puzzle-pieces/constellation`, a separate constellation root).
  Pieces resolve to the CLI's major.minor (D32), so the version must equal the
  root's exactly; `release:prep` asserts package.json, demo/package.json, and
  the demo header badge, and prints the pieces publish in the release order —
  a directory publish, safe here because pieces has no pin injection.
  Published versions carry `repository.directory: "packages/puzzle-pieces"`.
- **`packages/puzzle-devtools`** — the Chrome DevTools extension (D100). Its
  `@magic-spells/puzzle` dependency is a `file:../..` link, so the vitest suite
  and panel build always run against the working-tree runtime; CI runs the
  suite unconditionally, so a framework breaking change fails the build the day
  it lands instead of at the next extension release. `private: true` forever —
  "publishing" is always the extension zip
  (`npm run build:compiler` at root, then `build.mjs`, which defaults to the
  monorepo binary `../../puzzle`), never npm.

The pieces demo's framework dep is `file:../../..` and its scripts run the
in-repo CLI via `go run` — no published-version range exists in the train, so
there is no release-window state where `npm ci` cannot resolve. Compile-time
resolution is the compiler's in-repo walk in every case.

**What stays out.** The three editor grammars (puzzle-vscode / puzzle-sublime /
puzzle-zed) stay in separate repos: their distribution channels are repo-shaped
— Zed's extension registry submodules the extension repo and pins the grammar
by repo+commit, and Package Control reads git tags as versions, which would
collide with this repo's release tags. Their forcing function is the release
checklist sweep (and the grammar repos' example parse-sweeps), not co-location.
puzzle-eslint / puzzle-prettier belong under `packages/` as well — they vendor
a JS port of `sections.go`, code-level coupling — but land in a follow-up once
brought current (they predate `{#raw}` and have never shipped).

**Archive, never delete.** Absorbed repos are archived on GitHub after a final
pointer-README commit: published npm metadata links to them, PR/issue history
lives only in GitHub's copy, and an archived name cannot be squatted.

## Why

The separate repos manufactured coordination work and then failed at it:
pieces publishing had a timing rule ("at or before the CLI release, or
zero-config `add piece` breaks") enforced by nothing; the devtools panel sat
hard-broken against a framework release for a week because no suite ran when
the framework moved; and both repos ran on hand-rolled workspace substitutes
(a `PUZZLE_PIECES_REGISTRY` shell override, a hand-made `node_modules`
symlink). Co-location plus `release:prep` asserts plus unconditional CI turns
all of that into machine-checked properties of one branch.

## Alternatives rejected

- **Grammars in the monorepo too** — npm-distributed packages don't care where
  they live, but Zed and Sublime distribution is keyed to standalone repos and
  tag namespaces; two of three grammars can't move, and moving only vscode
  would split one uniform family across two workflows.
- **Full Embla shape immediately** (framework → `packages/puzzle`, private
  workspace root) — all churn, no user-visible gain, and it destabilizes the
  release pipeline exactly when a release is mid-flight. Staged instead; see
  the note.
- **npm workspaces at the root** — see the note; the root manifest is the
  shipped artifact.
- **Keeping the pieces GitHub Pages demo deploy** — the site's
  `/puzzle-pieces` page is the live catalog; a second deployment of the same
  content from CI is maintenance with no audience. The archived repo keeps
  serving its last deploy until taken down.
