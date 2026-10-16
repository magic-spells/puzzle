---
name: Puzzle
status: built
connected_repos:
  - name: puzzle-lang
    path: ../puzzle-lang
    description: >-
      The Puzzle template language Go module (parser, jsident, textutil; D172) — owns the parser's
      FILE cards and the parser test card
---

# Puzzle project map

Puzzle is a SPA-first JavaScript framework: `.pzl` single-file components, a
reactive browser runtime, and a Go + esbuild compiler/CLI. Optional build-time
prerendering (`output: 'hybrid'` or `'static'`) adds no SSR server and no
hydration. Puzzle is one template language with two hosts: PuzzleKit (this
package) compiles templates to JavaScript, and Magic Spells Sites renders them
in Go ([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]). The parser and expression
grammar live in the `packages/puzzle-lang` Go module, whose FILE and test
cards are in the connected repo `puzzle-lang`.

[[DOC-SPEC]] is the enforceable contract and wins every conflict; decision
cards explain its shape; [[DOC-RELEASE-SURFACE]] inventories what ships.

## Current state

- **npm `latest` is 0.8.0** (2026-10-01, [[RELEASE-V0-8-0]]). Never recommend 0.3.0 (published broken; use 0.3.1).
- **0.9.0 is in progress on `release/0.9.0`, not tagged or published** ([[RELEASE-V0-9-0]]): multilingual static sites (D177), `afterUpdate(prev)` (D178), `staticPaths` (D179), and bounded runtime component selection (D180 / [[FEATURE-COMPONENT-SLOT]]).
- The repo is a monorepo ([[DECISION-D162-MONOREPO-PACKAGES]]); every package in the release train carries the framework version. The three editor grammars are separate, dev-install-only repos with their own versions; sweep them whenever the template grammar changes.
- **The next free decision number is D181.**

## Open and deferred

Structural limits, not bugs:

- `output: 'static'` pages carry neither `beforeRequest` (D91) nor router focus
  and announcement (D93): they ship no router, and `mountStatic` options are
  serialized into a generated module, so functions cannot cross.
- Height animations need explicit px; WAAPI cannot animate to `auto`.

Deferred, with the reason:

- Async `beforeRequest` (inline token refresh) — puts an `await` before every
  adapter call and needs a coalescing story; widening sync→async stays
  compatible.
- `setData()` rerunning `data()` when it touches keys `data()` read
  ([[DECISION-D23-REFRESH-PATTERN]]) — today pair `setData` with `refresh()`.
- Link preloading (the other half of lazy routes), `<Portal>` named outlets,
  and element actions (the SPEC's deferred list carries the rationale).
- Editor-level type checking — waits on the official TypeScript 7 tooling API;
  nothing here builds on TypeScript 6-era compiler APIs.
- Tailwind standalone-binary support in the styles runner.
- Unscheduled: `<KeepAlive>`-style view retention, a schema-derived forms
  helper, global event bindings, per-subtree provide/inject, `build --analyze`,
  deploy presets, content collections, the playground's worker/UI phases
  (the WASM core is [[COMPONENT-PLAYGROUND-COMPILER]]).

Rejected (don't re-propose without new evidence):

- A `puzzle dev` mock API server — the fixtures mock adapter needs no server
  and behaves identically in dev and in Vitest.
- Open-ended dynamic module resolution (`<component is="module-name">`) — rejected. `<Component>` (D180) selects only constructors already imported by its file, through `is={ value }`, including ordinary script-map lookup `is={ cards[key] }`; no registry, lazy manifest or runtime string-to-module lookup. `{#if}`/`{#case}` remain useful when branches need different markup.

## Release checklist

[[FLOW-RELEASE]] holds the full procedure. Agents never tag, publish, or merge
release branches into `main`; Cory does.

1. Truth the prose: CHANGELOG completeness, README, `CLAUDE.md`,
   [[DOC-RELEASE-SURFACE]], and `skills/puzzle/SKILL.md` — it is `go:embed`ed,
   so a stale skill ships as the agent's picture of the framework
   ([[DECISION-D78-AGENT-SKILL-DISTRIBUTION]]).
2. Bump every stamp `release:prep` asserts, including the `FRAMEWORK_VERSION`
   literal in `client-runtime/devtools.js` and the sibling packages, and sweep
   the `@magic-spells/puzzle` ranges in the scaffold templates and
   `examples/*/package.json`.
3. Check that every web component a piece depends on is published at its
   declared floor ([[DECISION-D169-REGISTRY-VERSION-FLOORS]]).
4. Do not ship while any suite fails (`npx vitest run`, `go test ./...` in
   `compiler/` and in `packages/puzzle-lang`, plus types/pack/e2e/browser),
   a current doc contradicts [[DOC-SPEC]] or the code, or integrity reports
   dangling connections.
5. `npm run release:prep`; publish the platform packages, then the root as
   the packed tarball ([[DECISION-D120-TARBALL-PUBLISH]]), then the matching
   `@magic-spells/puzzle-pieces`; tag `vX.Y.Z` and
   `packages/puzzle-lang/vX.Y.Z`.
6. `npm run verify:published`, then smoke install, scaffold, dev, production
   build and static build from a clean consumer.

## Card map

### Contracts and releases

- [[DOC-SPEC]] — the frozen contract; a section index over
  [[DOC-SPEC-ANATOMY]] (naming, config, `.pzl` anatomy, layout, styles),
  [[DOC-SPEC-TEMPLATE]] (grammar, expressions, events, slots, islands),
  [[DOC-SPEC-VIEW]] (lifecycle, animations, refs, morphs),
  [[DOC-SPEC-DATA]] (models, store, adapter, fixtures),
  [[DOC-SPEC-ROUTER]] (routing, commit, head, guards, focus), and
  [[DOC-SPEC-BUILD]] (CLI, dev, output modes, testing, DevTools). `§N`
  numbers never move.
- [[DOC-LANGUAGE-CORE]] — the shared language across both hosts.
- [[DOC-RELEASE-SURFACE]] — the shipped-surface inventory.
- `RELEASE-V0-*` — theme and upgrade notes per version; [[FLOW-RELEASE]] is
  the publish procedure.

### Runtime

- [[COMPONENT-PUZZLE-APP]], [[COMPONENT-ROUTER]], [[COMPONENT-PUZZLE-VIEW]],
  [[COMPONENT-VIEW-MANAGER]], [[COMPONENT-ANIMATIONS]], [[COMPONENT-MORPH]].
- [[COMPONENT-STORE]], [[COMPONENT-PUZZLE-MODEL]], [[COMPONENT-ADAPTER]] (the
  opt-in `/adapter` sync runtime).
- [[COMPONENT-FORMATTERS]] — the function library registry and built-ins.
- [[COMPONENT-SSG]] — prerender runtime and serializer for both output modes.
- [[COMPONENT-DEVSTATE]] — dev reload state transfer and the live-view
  registry the DevTools bridge ([[FILE-DEVTOOLS]]) observes.
- [[COMPONENT-TESTING]], [[COMPONENT-FIXTURES]] — the `/testing` and
  `/fixtures` subpaths.

### Compiler and tooling

- [[COMPONENT-TEMPLATE-PARSER]] — sections, grammar, expressions, errors
  (code in `packages/puzzle-lang`).
- [[COMPONENT-CODEGEN]], [[COMPONENT-ESBUILD-PLUGIN]],
  [[COMPONENT-COMPILER-CLI]], [[COMPONENT-DEV-SERVER]],
  [[COMPONENT-PLAYGROUND-COMPILER]].

### Flows and states

- [[FLOW-BUILD]], [[FLOW-DEV-REBUILD]], [[FLOW-PRERENDER]],
  [[FLOW-REACTIVITY]], [[FLOW-NAVIGATION]], [[FLOW-ADAPTER-SYNC]].
- [[STATE-NAVIGATION]], [[STATE-RECORD]], [[STATE-VIEW-LIFECYCLE]].

### References

- App authors: [[DOC-USER-GUIDE]], [[DOC-PUZZLE-FILE]],
  [[DOC-TEMPLATE-SYNTAX]], [[DOC-EVENTS]], [[DOC-MODELS]],
  [[DOC-DATASTORE]], [[DOC-ROUTER]], [[DOC-APP-STRUCTURE]],
  [[DOC-THIRD-PARTY-DOM]].
- Contributors: [[DOC-ARCHITECTURE]], [[DOC-APP-ANATOMY]],
  [[DOC-VIEW-LIFECYCLE]], [[DOC-RUNTIME-KERNEL]], [[DOC-COMPILER-DESIGN]],
  [[DOC-COMPILATION-FLOW]], [[DOC-TESTING]], [[DOC-DEVELOPMENT]],
  [[DOC-STRESS-EXAMPLE]], [[DOC-GLOSSARY]].

## Conventions

- Read the cards covering an area before changing its code, and update them
  in the same work.
- A SPEC change needs a decision card: a new question gets the next number;
  a changed answer rewrites its existing card in place (one decision, one
  card), with the discarded approach as one line under Alternatives.
- Component, flow and doc cards describe current behavior and durable
  gotchas; git and CHANGELOG.md keep the history.
- Label future and rejected ideas explicitly; never blur them into the
  shipped surface.
- Terms: template library entries are *functions* (never filters or pipes;
  `formatters` is only the config key); the default router mode is *path
  routing*, never "history".
