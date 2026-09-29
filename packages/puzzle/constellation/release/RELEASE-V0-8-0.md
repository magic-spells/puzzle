---
name: 0.8.0 — one language, incremental rendering
status: building
version: 0.8.0
connections:
  - RELEASE-V0-7-0
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D171-ADD-THEME
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D175-TRANSLATIONS
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DECISION-D168-TEXT-RUN-WHITESPACE
  - DECISION-D169-REGISTRY-VERSION-FLOORS
  - DECISION-D76-CLI-UPGRADE
  - DOC-RELEASE-SURFACE
  - FLOW-RELEASE
---

# 0.8.0 — one language, incremental rendering

On `release/0.8.0`; every feature PR is merged, but it is not tagged or
published — npm `latest` is [[RELEASE-V0-7-0]]. The never-published 0.7.1
work (registry version floors, the background update notice, the
`puzzle init` Quick Start) is folded in; there is no `v0.7.1` tag.

Puzzle becomes one template language with two hosts: PuzzleKit (this package,
compiled to JavaScript) and Magic Spells Sites (rendered in Go). Heavily
breaking for templates.

## What's in it

- **Expression language** — [[DECISION-D176-EXPRESSION-LANGUAGE]]: what sits
  between braces is JavaScript from a closed table, parsed by
  `packages/puzzle-lang/expr`. Display transforms are function calls
  (`{ currency(price) }`); there are no `|` pipes, `.length` is the count, and
  `this` is a compile error in a template.
- **One language, two dialects** — [[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]:
  the parser lives in the `packages/puzzle-lang` Go module.
- **Core semantics** — [[DECISION-D173-CORE-SEMANTICS]]: guarded member
  access, loop domain, value printing, the slot-filled rule, object-literal
  arguments, script-less components.
- **Function library** — [[DECISION-D174-STANDARD-FORMATTERS]]: 19 standard
  functions plus PuzzleKit-only `link` and `timeago`; sanitized `raw`.
- **Translations** — [[DECISION-D175-TRANSLATIONS]]: `t(key, vars)`, locale
  files, `setLocale`.
- **Incremental rendering** — [[DECISION-D170-INCREMENTAL-VDOM-LISTS]]:
  persistent `{#for}` rows, static-subtree caching, stable row handlers,
  record render revisions.
- **Whitespace** — [[DECISION-D168-TEXT-RUN-WHITESPACE]]: one merged rule;
  `<pre>`/`<textarea>` preserved.
- **CLI and pieces** — [[DECISION-D171-ADD-THEME]] (`puzzle add theme`),
  [[DECISION-D169-REGISTRY-VERSION-FLOORS]], the non-blocking update notice
  ([[DECISION-D76-CLI-UPGRADE]]), `app/app.ts` as a build entry,
  `puzzle init --typescript`, TypeScript output from `puzzle generate`, and
  100 pieces.

## Upgrade notes

The CHANGELOG's 0.8.0 entry opens with "Upgrading from 0.7" and "Traps when
upgrading from 0.7". That is the upgrade guide; it is not repeated here.

## Publish

Follow [[FLOW-RELEASE]]. New this release: the `packages/puzzle-lang/v0.8.0`
tag beside `v0.8.0`, so outside Go consumers can resolve the module.
