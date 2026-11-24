---
name: The add CLI — resolver + copier
status: verified
connections:
  - DOC-REGISTRY
  - DECISION-REGISTRY-SHAPED-REPO
  - DECISION-COPY-IN-DISTRIBUTION
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# The add CLI — resolver + copier

**Shipped as `puzzle add piece <name…>` and `puzzle add theme [name…]` in the Puzzle Go CLI** (framework-CLI integration chosen over a standalone npm CLI). The `@magic-spells/puzzle-pieces` npm package is the versioned transport the CLI downloads: `files: ["registry"]`, the framework's major.minor, its own patch. Apps never install it for pieces; they install it only to import the theme files and the appearance helper. The code lives in `../puzzle/compiler/internal/pieces/` and `../puzzle/compiler/cmd/puzzle/add.go`. Because the repo is registry-shaped ([[DECISION-REGISTRY-SHAPED-REPO]]) the CLI is a pure resolver + file-copier, never a build tool.

## Shipped contract (what this registry must stay compatible with)

1. **Registry source chain:** `--registry <path|url|npm:pkg[@version]>` flag → `PUZZLE_PIECES_REGISTRY` env var → default: the `@magic-spells/puzzle-pieces` npm package, resolved to the newest release matching the CLI's own major.minor. With no such release the command errors; `--pieces-version` pins an exact version. Publishing the package is what makes the default source work ([[RELEASE-V0-1-0]]).
2. Reads `registry.json`; resolves requested pieces **plus `registryDependencies` transitively** (dedupe). Pieces → `app/components/ui/`, `lib/*.js` → `app/lib/`.
3. **Refuses to overwrite an existing target unless `--force` (`-f`)** — all-or-nothing pre-flight. `--overwrite` is a silent hidden alias through 0.10.x, because a 0.9 `puzzle upgrade` re-runs the new binary with `add skills --overwrite`. Refusal messages and the stale-theme hint name `--force`.
4. **Prints — never auto-runs — the npm install** for accumulated `dependencies` (e.g. `@magic-spells/morph-engine`) **and one `@import "<spec>" layer(components);` line per stylesheet** in the resolved manifests' `styles` (load order kept, the first after `@import "tailwindcss";`, each later one after the line before it). Never rewrites user files (Puzzle D3 precedent: print snippets).
5. **Theme is copied like a piece:** `theme/pieces.css` is written verbatim to `app/styles/pieces.css` (+ lock entry) when the app has neither the tokens nor the file, and the one-line `@import './pieces.css';` wiring step is printed (styles.css is user-owned). styles.css counts as themed when it holds the `puzzle-pieces design tokens` header comment, a live `@import` of `./pieces.css` (a comment that mentions the file does not count), or the default palette imported from the npm package. A `pieces.css` that exists but is not imported gets only the printed hint. **Don't reword that header comment without updating the CLI's marker.**
6. **No header stamps** — copies stay byte-identical to the registry (diffable). `pieces.lock` at the consumer app root records **sha256 content hashes** per piece/lib (hashes, not versions, so nothing needs bumping) enabling a future `diff`/`update` to distinguish upstream-changed from locally-customized.

## Remaining follow-ups

- Docs pages for the CLI flow (in the demo docs site or the future Astro docs).
- The `diff`/`update` command built on `pieces.lock`.
