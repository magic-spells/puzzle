---
name: Puzzle Pieces
connected_repos:
  - name: puzzle
    path: ../..
    description: >-
      The Puzzle framework — the .pzl compiler + runtime pieces are built for. Has its own
      constellation plan.
  - name: morph-engine
    path: ../morph-engine
    description: >-
      @magic-spells/morph-engine — the one published npm dep morph pieces (Select, Dialog,
      DatePicker) declare.
  - name: magic-spells-site
    path: ../magic-spells-site
    description: Astro marketing site — the future home of long-form public docs (DECISION-DOCS-DEMO-SPLIT).
connections:
  - DIAGRAM-TOPOLOGY
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
  - FEATURE-ADD-CLI
  - RELEASE-V0-1-0
  - DECISION-COPY-IN-DISTRIBUTION
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-REGISTRY-SHAPED-REPO
  - DECISION-DOCS-DEMO-SPLIT
  - DECISION-CONFIG-FIRST-API
---

# Puzzle Pieces

A **copy-in** UI component registry for the [Puzzle framework](../..):
90 Tailwind-styled, accessible, morph-aware `.pzl` pieces distributed as **source you
copy into a consumer app**, not packages you install. This card is the map; the
always-load rules, conventions, and hard-won gotchas live in `CLAUDE.md` (read it every
session) and are not duplicated here.

## The whole idea in one paragraph


`.pzl` single-file components can't ship via npm (the Puzzle compiler prunes
`node_modules` and `.pzl` isn't resolvable there; Tailwind only scans `app/`), so pieces
land in the consumer's own `app/components/ui/` where their `puzzle build` compiles them
and their Tailwind scan picks up the classes. Everything downstream of that choice — the
registry shape, the CLI, how a piece is built (a thin wrapper over the published web
component where possible, a native rebuild otherwise) — follows from it. See
[[DECISION-COPY-IN-DISTRIBUTION]] and [[DECISION-WRAP-WEB-COMPONENTS]].

## How the repo fits together

- [[DIAGRAM-TOPOLOGY]] — registry → demo / CLI → consumer at a glance.
- [[DOC-REGISTRY]] — `registry/` is the source of truth: `piece.json` manifests,
  the generated `registry.json` index, `theme/pieces.css` tokens, `lib/` helpers.
- [[DOC-DEMO-DOCS-SITE]] — the in-repo `demo/` Puzzle app (port 3070): the
  docs shell + dev/integration harness that consumes copies of the pieces.
- [[FEATURE-ADD-CLI]] — the shipped `puzzle add piece <name…>` resolver+copier (lives in the Puzzle Go CLI).
- [[RELEASE-V0-1-0]] — the first-publish milestone + current publishing state + open items.

## The settled decisions (don't re-litigate without the maintainer)


- [[DECISION-COPY-IN-DISTRIBUTION]] — copy-in, not npm import (npm rejected for v1).
- [[DECISION-WRAP-WEB-COMPONENTS]] — wrap the existing `@magic-spells/*` web components
  directly whenever possible (2026-08-22; reversed the original rebuild-everything rule);
  port only when wrapping genuinely can't work. Ported pieces still use no custom elements.
- [[DECISION-REGISTRY-SHAPED-REPO]] — registry-shaped from day one so the CLI stays a copier.
- [[DECISION-CONFIG-FIRST-API]] — config-first APIs, because Puzzle has no cross-component context.
- [[DECISION-DOCS-DEMO-SPLIT]] — docs in the demo app now, Astro on `magic-spells-site` later.

## Current state

All 90 pieces are built, compile-verified against the real compiler, and demo-verified.
The [[FEATURE-ADD-CLI]] shipped in the Puzzle Go CLI (`puzzle add piece`). Publishing
v0.1.0 means making this repo public — no npm package — and is tracked in
[[RELEASE-V0-1-0]]. Sibling repos are linked in `connected_repos` above (`repo:`
selector targets each).
