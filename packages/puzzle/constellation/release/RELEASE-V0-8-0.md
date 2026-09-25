---
name: 0.8.0 — one language, incremental rendering
status: building
version: 0.8.0
connections:
  - RELEASE-V0-7-0
  - RELEASE-V0-7-1
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D171-ADD-THEME
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D175-TRANSLATIONS
  - DECISION-D168-TEXT-RUN-WHITESPACE
  - DECISION-D169-REGISTRY-VERSION-FLOORS
  - DOC-RELEASE-SURFACE
  - FLOW-RELEASE
---

# 0.8.0 — one language, incremental rendering

Release prep is under way on `release/0.8.0`: every feature PR is merged,
but 0.8.0 is not published and not tagged, so nothing in it should be
described as shipped. npm `latest` is [[RELEASE-V0-7-0]]. The
never-published [[RELEASE-V0-7-1]] is folded in.

A minor with more breaking edges than usual. Puzzle becomes one template
language with two dialects (PuzzleKit and Sites), and making the shared
constructs mean one thing changes what some existing templates print.

## What's in it

- **Incremental rendering** — [[DECISION-D170-INCREMENTAL-VDOM-LISTS]]:
  persistent `{#for}` row blocks, static-subtree caching, identity-stable row
  handlers, record render revisions.
- **One language, two dialects** — [[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]],
  with the template parser extracted into the `packages/puzzle-lang` Go module
  (its own constellation root and its own `packages/puzzle-lang/vX.Y.Z` tag).
- **Core semantics** — [[DECISION-D173-CORE-SEMANTICS]]: pipes are formatters
  in every value position and banned from `{#for}` headers and `{:when}`,
  `?.` member guarding, loop domain, the slot-filled rule, value printing,
  object-literal arguments, script-less components.
- **The standard formatter set** — [[DECISION-D174-STANDARD-FORMATTERS]]: 35
  names, the list-formatter and `noescape` removals, sanitized `raw` and live
  `newline_to_br`.
- **Translations** — [[DECISION-D175-TRANSLATIONS]]: `t`, locale files,
  `ctx.i18n`, `setLocale`.
- **Whitespace** — [[DECISION-D168-TEXT-RUN-WHITESPACE]] rewritten as the
  merged rule; `<pre>`/`<textarea>` preserved.
- **Pieces and CLI** — [[DECISION-D171-ADD-THEME]] (`puzzle add theme`, four
  palettes × three modes, `appearance-picker`), 100 pieces, the
  morph-engine `^0.4.2` floor, [[DECISION-D169-REGISTRY-VERSION-FLOORS]], the
  D76 background update notice, and the runtime preflight.

Production sizes: hello-world 21.5 KB gzip, todos 25.5 KB gzip.

## Upgrade notes

The CHANGELOG's 0.8.0 entry opens with a 14-item "Upgrading from 0.7"
checklist. That checklist is the upgrade guide, so it is not repeated here.

## Publish

Tag `v0.8.0` and `packages/puzzle-lang/v0.8.0`. Publish the five platform
packages, then the root tarball, then `@magic-spells/puzzle-pieces@0.8.0`.
Then run `verify:published`.
