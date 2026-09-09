---
name: Puzzle Pieces
connected_repos:
  - name: puzzle
    path: ../puzzle
    description: >-
      The Puzzle framework — the .pzl compiler + runtime pieces are built for. Has its own
      constellation plan.
  - name: morph-engine
    path: ../../../morph-engine
    description: >-
      @magic-spells/morph-engine — the one published npm dep morph pieces (Select, Dialog,
      DatePicker) declare.
  - name: magic-spells-site
    path: ../../../magic-spells-site
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

A **copy-in** UI component registry for the [Puzzle framework](../puzzle):
97 Tailwind-styled, accessible, morph-aware `.pzl` pieces distributed as **source you
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


All 97 pieces are built, compile-verified against the real compiler, and demo-verified.
The [[FEATURE-ADD-CLI]] shipped in the Puzzle Go CLI (`puzzle add piece`).
[[RELEASE-V0-1-0]] records the first publish (2026-07-22, the repo going public); since
then the registry itself ships as the npm package `@magic-spells/puzzle-pieces`, which
`puzzle add piece` resolves by default and which is **version-locked to the framework's
major.minor** — so this package's version must equal the framework's exactly, and the
matching pieces release must publish at or before the CLI release.

**`0.7.0` is live on npm and is the current `latest`,** published 2026-09-09 alongside
framework 0.7.0. The version-locked transport is verified end to end: the framework's
`verify:published` asserts `@magic-spells/puzzle-pieces` exists at the EXACT framework
version, then scaffolds an app with the installed CLI and confirms `add piece` resolves
`npm:@magic-spells/puzzle-pieces@0.7.0` — with `PUZZLE_PIECES_REGISTRY` deleted from the
child env, so local registry files cannot satisfy the check, and with the
compatibility-fallback notice treated as a failure. A fresh-app smoke went further:
`puzzle init`, then `add piece accordion`, then `@magic-spells/collapsible-content`
1.2.0, builds with the web component bundled.

**Publishing lesson from that release, still unfixed in the registry format:** a
`piece.json` declares its web-component dependencies by **bare name**, so npm resolves
them to `latest`. The 0.7.0 families were authored against unpublished local versions,
which meant eight upstream components had to be published by hand before the release
could go out at all — collapsible-content 1.2.0, dropdown-panel 2.1.0, tab-group 1.2.0,
select-dropdown 0.3.0, split-panel 0.2.0, panel-stack 0.2.0, scrolling-content 2.1.0,
quantity-input 1.1.0 — and the demo's own `file:` paths swapped to npm. Until registry
version floors land as D169 in framework 0.7.1, treat "every web component a piece
depends on is published at the version the piece was built against" as a hard release
gate. See [[DECISION-WRAP-WEB-COMPONENTS]].

This package lives at `packages/puzzle-pieces` inside the `magic-spells/puzzle`
monorepo (framework decision D162), with its own npm install and lockfile — there are
deliberately no npm workspaces. Sibling repos are linked in `connected_repos` above
(`repo:` selector targets each); the framework's own plan is `repo: puzzle`.

0.7.0 shape: most overlay and disclosure pieces are now wrappers or D167 **component
families** over published `@magic-spells/*` web components — `DropdownPanel` is the
shared base family behind DropdownMenu, ContextMenu, SplitButton, Popover, HoverCard,
Menubar, Popconfirm and NavigationMenu — and `puzzle add piece` installs those compound
pieces path-preserving. The six assembled app demos (analytics, chat, banking, admin,
project board, storefront) moved out of `demo/` into their own `puzzle-demos` repo; the
demo app keeps the piece copies, the `*Doc` pages, and the docs shell.
