---
name: Copy-in distribution, not npm import
status: built
connections:
  - DOC-REGISTRY
  - FEATURE-ADD-CLI
  - RELEASE-V0-1-0
  - DECISION-REGISTRY-SHAPED-REPO
---

# Copy-in distribution, not npm import

## Context

Pieces are `.pzl` single-file components for the [Puzzle framework](../..). The natural instinct is to publish them as an npm package apps `import`. That does not work for `.pzl`.

## Decision

Pieces are distributed as **source copied into the consumer's `app/components/ui/`** — never installed from npm. The published package (when it ships) carries the registry + CLI; nobody imports it at runtime.

## Alternatives rejected

- **npm-import distribution of `.pzl`** — rejected for v1, and it is structural, not taste:
  1. The Puzzle compiler's formatter scan *prunes* `node_modules` (out of scope for v1 per the compiler source), so a package-shipped `.pzl` is never compiled.
  2. `.pzl` is not in the compiler's resolve extensions — an npm Puzzle component would have to hand-write `render()` against `ViewNode`/`SLOT_TAG` (the pain is documented in `../tarot-puzzle/docs/PUZZLE-FRICTION.md` item 7).
  3. The app's Tailwind `@source` scan only covers `app/`, so a package-shipped piece renders **unstyled**.
  Copied files land in `app/`, compile with the consumer's own `puzzle build`, and their classes get scanned. Plain-JS npm packages *do* work in `node_modules` — that is why `dependencies` in a manifest (e.g. `@magic-spells/morph-engine`) are real npm installs while the `.pzl` never is.

## Consequences


- The repo is shaped as a registry from day one ([[DECISION-REGISTRY-SHAPED-REPO]]); the [[FEATURE-ADD-CLI]] is a copier, not a bundler.
- Copied code is the user's to restyle and fork — updates are a future `diff`/`update` concern, not an npm bump.
- Two lineages coexist: the `@magic-spells/*` web components keep shipping via npm for non-Puzzle contexts. A *wrapped* piece consumes that npm package directly (the `.pzl` is a thin copied shell; behavior updates arrive by version bump); a *ported* piece is a deliberate fork. Which a piece is follows [[DECISION-WRAP-WEB-COMPONENTS]] — wrap whenever possible.
