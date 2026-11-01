---
name: Puzzle
status: built
connected_repos:
  - name: puzzle-lang
    path: ../puzzle-lang
    description: >-
      The Puzzle language Go module (parser, expr, conformance, jsident, textutil; D172) — owns the
      parser's FILE cards and the parser test card
---

# Puzzle project map

Puzzle is a SPA-first JavaScript framework: `.pzl` single-file components, a reactive browser runtime, and a Go + esbuild compiler/CLI. Optional build-time prerendering (`output: 'hybrid'` or `'static'`) adds no SSR server and no hydration. Puzzle is one template language with two hosts: PuzzleKit (this package) compiles templates to JavaScript, and Magic Spells Sites renders them in Go ([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]). The parser and expression grammar live in the `packages/puzzle-lang` Go module, whose FILE and test cards are in the connected repo `puzzle-lang`.

[[DOC-SPEC]] is the enforceable contract and wins every conflict; decision cards (`DECISION-D*`) hold the rationale, one card per question; [[DOC-RELEASE-SURFACE]] inventories what ships; [[DOC-ARCHITECTURE]] is the internal map.

## Current state

- npm `latest` is **0.9.0**. **`release/0.10.0` is the working trunk** (unpublished). Check `npm view @magic-spells/puzzle version` and `git tag` before trusting this line. Never recommend 0.3.0 (published broken).
- The repo is a monorepo ([[DECISION-D162-MONOREPO-PACKAGES]]); every package in the release train carries the framework version. `packages/puzzle-lang` is tagged `packages/puzzle-lang/vX.Y.Z` and may ship Go-module-only patch releases (0.9.1 added the Sites `|` pipes, `Options.Pipes`).
- The three editor grammars are separate, dev-install-only repos with their own versions; sweep them whenever the template grammar changes.
- **The next free decision number is D190.**

## Open and deferred

The "Deferred features" section of [[DOC-SPEC]] lists deferred and rejected features with their reasons; don't re-propose a rejected one without new evidence. Structural limits that are not bugs:

- `output: 'static'` pages carry neither `beforeRequest` nor router focus/announcement: they ship no router, and `mountStatic` options are serialized into a generated module, so functions cannot cross.
- Height animations need explicit px; WAAPI cannot animate to `auto`.
- `setData()` does not rerun `data()` when it touches keys `data()` read ([[DECISION-D23-REFRESH-PATTERN]]); pair it with `refresh()`.

Unscheduled ideas (no design yet): `<KeepAlive>`-style view retention, a schema-derived forms helper, global event bindings, per-subtree provide/inject, `build --analyze`, deploy presets, content collections, Tailwind standalone-binary support, the playground's worker/UI phases (the WASM core is [[COMPONENT-PLAYGROUND-COMPILER]]).

## Releasing

[[FLOW-RELEASE]] is the procedure and `packages/puzzle/CLAUDE.md` the checklist. Agents never tag, publish, or merge release branches into `main`; Cory does. Do not ship while a suite fails, a current doc contradicts [[DOC-SPEC]] or the code, or integrity reports dangling connections.

## Where things are

- **Contract:** [[DOC-SPEC]] indexes the six chapters by `§N` — [[DOC-SPEC-ANATOMY]], [[DOC-SPEC-TEMPLATE]], [[DOC-SPEC-VIEW]], [[DOC-SPEC-DATA]], [[DOC-SPEC-ROUTER]], [[DOC-SPEC-BUILD]]. [[DOC-LANGUAGE-CORE]] maps the language shared with Sites.
- **Runtime:** [[COMPONENT-PUZZLE-APP]], [[COMPONENT-ROUTER]], [[COMPONENT-PUZZLE-VIEW]], [[COMPONENT-VIEW-MANAGER]], [[COMPONENT-ANIMATIONS]], [[COMPONENT-MORPH]], [[COMPONENT-STORE]], [[COMPONENT-PUZZLE-MODEL]], [[COMPONENT-ADAPTER]], [[COMPONENT-FORMATTERS]], [[COMPONENT-SSG]], [[COMPONENT-DEVSTATE]], [[COMPONENT-TESTING]], [[COMPONENT-FIXTURES]].
- **Compiler and tooling:** [[COMPONENT-TEMPLATE-PARSER]], [[COMPONENT-CODEGEN]], [[COMPONENT-ESBUILD-PLUGIN]], [[COMPONENT-COMPILER-CLI]], [[COMPONENT-DEV-SERVER]], [[COMPONENT-PLAYGROUND-COMPILER]].
- **Flows and states:** [[FLOW-BUILD]], [[FLOW-DEV-REBUILD]], [[FLOW-PRERENDER]], [[FLOW-REACTIVITY]], [[FLOW-NAVIGATION]], [[FLOW-ADAPTER-SYNC]], [[FLOW-RELEASE]]; [[STATE-NAVIGATION]], [[STATE-RECORD]], [[STATE-VIEW-LIFECYCLE]].
- **App-author references:** start at [[DOC-USER-GUIDE]]; then [[DOC-PUZZLE-FILE]], [[DOC-TEMPLATE-SYNTAX]], [[DOC-EVENTS]], [[DOC-MODELS]], [[DOC-DATASTORE]], [[DOC-ROUTER]], [[DOC-APP-STRUCTURE]], [[DOC-THIRD-PARTY-DOM]].
- **Contributors:** [[DOC-ARCHITECTURE]], [[DOC-VIEW-LIFECYCLE]], [[DOC-COMPILER-DESIGN]], [[DOC-TESTING]], [[DOC-DEVELOPMENT]], [[DOC-STRESS-EXAMPLE]], [[DOC-GLOSSARY]].

## Conventions

- Read the cards covering an area before changing its code, and update them in the same work.
- A SPEC change needs a decision card: a new question gets the next number; a changed answer rewrites its existing card in place (one decision, one card), with the discarded approach as a short line under Alternatives.
- Component, flow and doc cards describe current behavior and durable gotchas; git and CHANGELOG.md keep the history.
- Label future and rejected ideas explicitly; never blur them into the shipped surface.
- Terms: template library entries are *functions* (never filters or pipes; `formatters` is only the config key); the default router mode is *path routing*, never "history".
