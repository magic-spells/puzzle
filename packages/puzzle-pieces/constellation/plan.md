---
name: Puzzle Pieces
connected_repos:
  - name: puzzle
    path: ../puzzle
    description: >-
      The Puzzle framework — the .pzl compiler + runtime pieces are built for. Has its own
      constellation plan.
  - name: morph-engine
    path: ../../../../open-sourcery/morph-engine
    description: >-
      @magic-spells/morph-engine — the npm dependency the morph pieces (DatePicker, EmojiPicker,
      EmojiPickerSimple) declare.
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
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
status: verified
---

# Puzzle Pieces

A **copy-in** UI component registry for the [Puzzle framework](../puzzle):
104 Tailwind-styled, accessible, morph-aware `.pzl` pieces distributed as **source you
copy into a consumer app**, not packages you install. This card is the map; the
always-load rules, conventions, and hard-won gotchas live in `CLAUDE.md` (read it every
session) and are not duplicated here.

## The whole idea in one paragraph

A Puzzle app can compile `.pzl` files from an installed package, but its Tailwind
scan skips `node_modules`, so an installed piece would render unstyled, and it would not be
the app's to edit. So pieces land in the consumer's own `app/components/ui/`, where their
`puzzle build` compiles them and their Tailwind scan picks up the classes. Everything
downstream of that choice — the registry shape, the CLI, how a piece is built (a thin
wrapper over the published web component where possible, a native rebuild otherwise) —
follows from it. See [[DECISION-COPY-IN-DISTRIBUTION]] and [[DECISION-WRAP-WEB-COMPONENTS]].

## How the repo fits together

- [[DIAGRAM-TOPOLOGY]] — registry → demo / CLI → consumer at a glance.
- [[DOC-REGISTRY]] — `registry/` is the source of truth: `piece.json` manifests,
  the hand-kept `registry.json` index, `theme/pieces.css` tokens, `lib/` helpers.
- [[DOC-DEMO-DOCS-SITE]] — the in-repo `demo/` Puzzle app (port 3070): the
  docs shell + dev/integration harness that consumes copies of the pieces.
- [[FEATURE-ADD-CLI]] — the shipped `puzzle add piece <name…>` resolver+copier (lives in the Puzzle Go CLI).
- [[RELEASE-V0-1-0]] — the first-publish milestone + current publishing state + open items.

## The settled decisions (don't re-litigate without the maintainer)


- [[DECISION-COPY-IN-DISTRIBUTION]] — copy-in, not npm import (npm rejected for v1).
- [[DECISION-WRAP-WEB-COMPONENTS]] — wrap the existing `@magic-spells/*` web components
  directly whenever possible; port only when wrapping genuinely can't work. Ported pieces
  still use no custom elements.
- [[DECISION-REGISTRY-SHAPED-REPO]] — registry-shaped from day one so the CLI stays a copier.
- [[DECISION-CONFIG-FIRST-API]] — config-first APIs, because Puzzle has no cross-component context.
- [[DECISION-DOCS-DEMO-SPLIT]] — docs in the demo app now, Astro on `magic-spells-site` later.

## Current state

All 104 pieces are built, compile-verified against the real compiler, and demo-verified.
The [[FEATURE-ADD-CLI]] shipped in the Puzzle Go CLI (`puzzle add piece`).
[[RELEASE-V0-1-0]] records the first publish. The registry ships as the npm package
`@magic-spells/puzzle-pieces`, which `puzzle add piece` resolves by default and which is
**version-locked to the framework's major.minor** — so this package's version must equal
the framework's exactly, and the matching pieces release must publish at or before the CLI
release.

The framework's `verify:published` checks the transport end to end: it asserts
`@magic-spells/puzzle-pieces` exists at the framework version, scaffolds an app with the
installed CLI, and confirms `add piece` resolves `npm:@magic-spells/puzzle-pieces@<version>`.
It deletes `PUZZLE_PIECES_REGISTRY` from the child env, so local registry files cannot pass
the check.

Every npm dependency in a `piece.json` carries a version floor
(`@magic-spells/collapsible-content@^1.2.0`), and `puzzle add piece` prints it as is (framework
D169). A floor must be published on npm before the pieces release ships.
`test/registry-deps.test.js` holds every floor to `demo/package.json`. See
[[DECISION-WRAP-WEB-COMPONENTS]].

This package lives at `packages/puzzle-pieces` inside the `magic-spells/puzzle`
monorepo (framework decision D162), with its own npm install and lockfile — there are
deliberately no npm workspaces. Sibling repos are linked in `connected_repos` above
(`repo:` selector targets each); the framework's own plan is `repo: puzzle`.

Most overlay and disclosure pieces are wrappers or D167 **component families** over
published `@magic-spells/*` web components — `DropdownPanel` is the shared base family
behind DropdownMenu, ContextMenu, SplitButton, Popover, HoverCard, Menubar, Popconfirm and
NavigationMenu — and `puzzle add piece` installs those compound pieces path-preserving. The
assembled app demos (analytics, chat, banking, admin, project board, storefront) live in
their own `puzzle-demos` repo; the demo app keeps the piece copies, the `*Doc` pages, and
the docs shell.
