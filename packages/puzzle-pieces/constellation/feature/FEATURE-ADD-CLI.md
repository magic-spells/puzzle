---
name: The add CLI — resolver + copier
status: built
connections:
  - DOC-REGISTRY
  - DECISION-REGISTRY-SHAPED-REPO
  - DECISION-COPY-IN-DISTRIBUTION
---

# The add CLI — resolver + copier

**Status: SHIPPED 2026-07-17 — as `puzzle add piece <name…>` in the Puzzle Go CLI** (framework-CLI integration chosen over a standalone npm CLI; the `@magic-spells/puzzle-pieces` npm package exists only as the versioned TRANSPORT the CLI downloads — `files: ["registry"]`, versioned in lockstep with the framework's major.minor, patch free for the registry — nobody installs or imports it). Lives in `../puzzle/compiler/internal/pieces/` + `add.go`, with 22 Go tests, verified end-to-end against this registry (button; date-picker → calendar + `lib/date-math.js` transitively; conflict refusal; consumer app builds with pieces + morph-engine). Because the repo is registry-shaped ([[DECISION-REGISTRY-SHAPED-REPO]]) the CLI is a pure resolver + file-copier, never a build tool.

## Shipped contract (what this registry must stay compatible with)

1. **Registry source chain:** `--registry <path|url|npm:pkg[@version]>` flag → `PUZZLE_PIECES_REGISTRY` env var → default: the `@magic-spells/puzzle-pieces` npm package, resolved to the newest release matching the CLI's own major.minor (`--pieces-version` pins an exact version). The raw-GitHub default is gone; publishing the package is what activates the default source (the repo going public is no longer the mechanism — cf. [[RELEASE-V0-1-0]]).
2. Reads `registry.json`; resolves requested pieces **plus `registryDependencies` transitively** (dedupe). Pieces → `app/components/ui/`, `lib/*.js` → `app/lib/`.
3. **Refuses to overwrite an existing target unless `--overwrite`** — all-or-nothing pre-flight.
4. **Prints — never auto-runs — the npm install** for accumulated `dependencies` (e.g. `@magic-spells/morph-engine`). Never rewrites user files (Puzzle D3 precedent: print snippets).
5. **Theme is copied like a piece:** `theme/pieces.css` is written verbatim to `app/styles/pieces.css` (+ lock entry) when the app has neither the tokens nor the file, and the one-line `@import './pieces.css';` wiring step is printed (styles.css is user-owned). Detection keys on the `puzzle-pieces design tokens` header comment / a `pieces.css` reference in styles.css — **don't reword that comment without updating the CLI's marker.**
6. **No header stamps** — copies stay byte-identical to the registry (diffable). `pieces.lock` at the consumer app root records **sha256 content hashes** per piece/lib (hashes, not versions, so nothing needs bumping) enabling a future `diff`/`update` to distinguish upstream-changed from locally-customized.

## Remaining follow-ups

- Docs pages for the CLI flow (in the demo docs site or the future Astro docs).
- The `diff`/`update` command built on `pieces.lock`.
