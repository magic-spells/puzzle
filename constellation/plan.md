---
name: Puzzle
verified_at: '2026-07-22T00:04:04.329Z'
status: verified
---

# Puzzle project map

Puzzle is a SPA-first JavaScript framework with `.pzl` single-file components,
a reactive browser runtime, and a Go + esbuild compiler/CLI. Optional static
generation prerenders routes without adding an SSR server or hydration layer.

[[DOC-SPEC]] is the enforceable contract and wins all conflicts. Decisions
D1-D87 in [[DOC-DECISIONS]] explain why the contract has its current shape.
[[DOC-RELEASE-SURFACE]] is the concise inventory of everything that ships.

## Current state

- `0.1.0` shipped publicly on npm 2026-07-21; `0.1.1` (interactive `puzzle
  init` prompts, D77/v1.44) followed 2026-07-22 (MIT, five packages, manual
  publish). `0.1.2` shipped the embedded agent skill + `puzzle add skills`
  installer (D78/v1.45, published 2026-07-22). Working version `0.2.0`
  (versions bumped, unpublished): mode-agnostic path-shaped links —
  `router.url()` + the built-in `link` formatter (D79/v1.46) — and the true
  static-pages output mode — `output: 'static'` / `--static` (D81/v1.47),
  with the D67 prerendered-SPA mode renamed `output: 'hybrid'` / `--hybrid`
  (the breaking config rename is what makes this 0.2.0). Also in 0.2.0
  (2026-07 framework-gap review — merged to main and verified: suites,
  three output modes, real-browser checks, +1.4 KiB gzip total): compiler
  a11y warnings (D82/v1.48), router query snapshot + `replace()`
  (D83/v1.49), route head management (D84/v1.50), FLIP keyed-reorder
  animation via a `flip` attribute (D85/v1.51), and the `@event:outside`
  modifier (D86/v1.52 — Cory's design; document-capture outside-dismiss,
  retiring the pattern 16 puzzle-pieces hand-roll) — zero new template
  grammar across all five. Element actions, `<Portal>`, and lazy routes
  were reviewed and deferred (SPEC deferred list has the rationale). Pieces
  migration to `@event:outside` is queued for AFTER 0.2.0 ships (older
  compilers reject unknown modifiers). Route guards followed (D87/v1.53 —
  the inherited `guard` route field; guard a top-level route to lock its
  layout subtree; suites + example verified, awaiting merge), then the dev
  server port scan (D90/v1.54 — `puzzle dev` takes the next free port
  instead of failing on a busy one, `--strict-port` to opt out).
  `examples/kanban` now drives its drag-shift animation from the `flip`
  attribute rather than hand-rolled `beforeUpdate`/`afterUpdate` rect
  snapshots; `examples/kanban-morph` still carries the manual version.
- Runtime, compiler, CLI, static generation (hybrid + static modes),
  state-preserving dev reload,
  TypeScript transpilation, model validation/relationships/write sync, nested
  routing, slots, refs, scoped styles, animations, and optional morphs are all
  implemented.
- The npm package includes the JavaScript runtime/types, the `puzzle` shim, and
  optional macOS/Linux binaries for arm64/x64.
- `examples/todos` is the canonical integration app. The rest of `examples/`
  are focused acceptance/showcase apps.
- The 0.1.0 backlog is done and published; open work is the 0.1.1 init
  prompts and launch assets (demo links, announcement).

## Deferred / known limitations

Explicitly future or unshipped, not release blockers:

- Tailwind standalone-binary support in the styles runner (consideration).
- D23 `setData` ergonomics papercut (`setData` re-running `data()` when it
  touches keys `data()` read; today pair `setData` with explicit `refresh()`).
- Height animations need explicit px — WAAPI cannot animate to `auto`.
- An async `beforeRequest` (D91) — inline token refresh. Deferred because
  awaiting the hook puts an `await` in front of every adapter call and needs a
  concurrent-refresh coalescing story. Widening sync→async stays compatible.
- A `puzzle dev` mock API server — deferred once D95's client-side mock adapter
  shipped: the adapter needs no server and behaves identically in `puzzle dev`
  and in Vitest, which a dev-server mock structurally cannot.
- **`output: 'static'` carries neither `beforeRequest` (D91) nor focus
  management / route announcement (D93).** Those pages ship no router, and
  `mountStatic`'s options are serialized into a generated per-page module, so a
  function cannot survive the boundary. Structural limits of the output mode,
  not bugs.

## Framework-gap review (2026-07-24)

A survey against React, Vue, Svelte, Ember, Angular, and Astro found the core
runtime broadly at parity — the remaining gaps sit in the layer *around* it
(tooling, testing, mocking, error handling, adoption surface), which is where
the mature frameworks actually differentiate.

Landed on `feat/framework-gaps`: D91 adapter `beforeRequest`, D92 dev build
errors in the browser, D93 router focus + route announcement, D94
`@magic-spells/puzzle/testing`, D95 schema-driven fixtures + mock adapter, and
D98 — the fixtures/mock system as a fully self-contained
`@magic-spells/puzzle/fixtures` module attached via `installFixtures()` and the
`puzzle dev|build --fixtures` flag (wired from `app/fixtures.js` through a
generated wrapper entry; core keeps only the ~5-line `Store._network` seam).

Two intermediate states were built and replaced on the branch: D95's original
integration baked ~154 lines into `store.js`, and D96 tree-shook it back out
with usage-scanned defines. D96 is SUPERSEDED by D98 — the defines were
fail-safe (a pre-D96 compiler shipped the whole runtime: measured 23025 vs
20702 gzip on `examples/todos`), and the conservative token scan compiled an
app's own `store.seed()` seeding into production. With D98, exclusion holds by
construction: nothing references the module without the flag.

D97 — `puzzle upgrade` offers to refresh the installed agent
skill after it installs a new version, closing D78's manual "upgrade + re-run"
loop. Because the payload is `go:embed`-ed, the refresh re-execs the binary npm
just installed (`--version`-gated) rather than writing the old skill this
process carries.

D99 finishes the thought on the `add` side: re-running `puzzle add skills` after
an upgrade IS the refresh mechanism, so an existing install now asks instead of
aborting, and installs carry a `.puzzle-skill-version` stamp that makes "is this
current?" a fact rather than an inference from the CLI version. `puzzle upgrade
skills` refreshes existing installs from the running binary — no registry check
and no re-exec, since nothing was upgraded.

The DevTools browser extension is now IN PROGRESS (D100, 2026-07-24): the
framework ships a dev-only bridge speaking SPEC §55's wire protocol on
`feat/devtools-bridge`; the extension lives in its own public repo
`magic-spells/puzzle-devtools` (MV3, panel UI dogfooded as a Puzzle app;
v1 = Views + Store panels). The store's `subscribersByKey`/`keysBySubscriber`
pair is the asset — it answers "which views re-render when this record
changes" exactly, which React and Svelte users answer by guessing; the
subscriptions-graph panel that exploits it follows v1.

Identified and **not** scheduled, roughly by value: error boundaries + an app
`onError` hook; dynamic
components (`<component is={}>`); `<KeepAlive>`-style view-state retention on
back-navigation; two-way `bind` sugar plus a schema-derived forms helper;
`<svelte:window>`-style global event bindings; per-subtree provide/inject;
`puzzle check` / an LSP over the compiler's existing positioned diagnostics;
i18n; `build --analyze`; `puzzle preview`; deploy presets; Astro-style content
collections; and a WASM playground.

## Release checklist

1. Keep README, CLAUDE, [[DOC-RELEASE-SURFACE]], and current-state component
   cards aligned with HEAD.
1a. Bump `FRAMEWORK_VERSION` in `client-runtime/devtools.js` alongside
   package.json — it is a hardcoded literal (no version constant exists in the
   runtime and the ESM bundle cannot import package.json), and the DevTools
   extension displays it and keys protocol compatibility on it (D100).
1b. Re-verify `skills/puzzle/SKILL.md` against the public surface. It is
   `go:embed`-ed, so a release ships whatever it says as the agent's picture of
   the framework — [[DECISION-D78-AGENT-SKILL-DISTRIBUTION]] called it
   release-checklist surface and nothing enforced it, so it silently drifted
   past D91/D93/D94/D95/D98. [[DECISION-D99-SKILL-REFRESH-PROMPT]] makes
   refreshing easy, which makes shipping a stale payload more costly, not less.
2. Run Vitest and all Go package tests; run type/package/example checks where
   the changed surface calls for them.
3. Verify the npm tarball and platform-package metadata.
4. Tag and publish the four platform packages before the root package.
5. Smoke-test install, scaffold, dev, production build, and static build from a
   clean consumer project.

## Card map

### Contracts and release truth

- [[DOC-SPEC]] — frozen public contract; every amendment requires a decision.
- [[DOC-DECISIONS]] — numeric decision index and links to ADR cards.
- [[DOC-RELEASE-SURFACE]] — complete, compact shipped-surface inventory.
- [[DOC-BUILD-PLAN]] — v1 implementation plan and release-phase status.

### Runtime components

- [[COMPONENT-PUZZLE-APP]] — app wiring and lifecycle.
- [[COMPONENT-ROUTER]] — routing, transitions, scrolling, and commit semantics.
- [[COMPONENT-PUZZLE-VIEW]] — component state and lifecycle.
- [[COMPONENT-VIEW-MANAGER]] — vnode/DOM patching and composition.
- [[COMPONENT-ANIMATIONS]] — WAAPI and visible-trigger scheduling.
- [[COMPONENT-STORE]] / [[COMPONENT-PUZZLE-MODEL]] — data layer.
- [[COMPONENT-FORMATTERS]] — formatter registry and built-ins.
- [[COMPONENT-DEVSTATE]] — development reload state transfer.
- [[COMPONENT-MORPH]] — optional shared-element morph integration.
- [[COMPONENT-SSG]] — prerender runtime and serializer; hybrid (SPA takeover)
  and static (per-page module, no router) output modes.

### Compiler and tooling

- [[COMPONENT-TEMPLATE-PARSER]] — `.pzl` sections, grammar, and errors.
- [[COMPONENT-CODEGEN]] — render emission and expression resolution.
- [[COMPONENT-ESBUILD-PLUGIN]] — bundling, config, styles, aliases, outputs.
- [[COMPONENT-COMPILER-CLI]] — CLI commands, scaffolds, generators, pieces.
- [[COMPONENT-DEV-SERVER]] — watch/rebuild/server/SSE loop.
- [[FLOW-BUILD]] / [[FLOW-REACTIVITY]] — end-to-end build and update flows.

### User and contributor references

- [[DOC-USER-GUIDE]], [[DOC-PUZZLE-FILE]], [[DOC-TEMPLATE-SYNTAX]],
  [[DOC-EVENTS]], [[DOC-MODELS]], [[DOC-DATASTORE]], [[DOC-ROUTER]].
- [[DOC-ARCHITECTURE]], [[DOC-APP-ANATOMY]], [[DOC-VIEW-LIFECYCLE]],
  [[DOC-RUNTIME-KERNEL]], [[DOC-COMPILER-DESIGN]], [[DOC-COMPILATION-FLOW]],
  [[DOC-TESTING]], [[DOC-DEVELOPMENT]], [[DOC-CODE-REVIEW]], [[DOC-GLOSSARY]].
- Example-specific cards document notable patterns; they are not substitutes
  for the public contract.

## Conventions

- Decision cards keep rationale and rejected alternatives. Git keeps the full
  timeline. Component/flow cards describe current behavior and durable gotchas,
  not release-by-release history.
- Read cards before changing covered code and update them in the same work.
- Keep future/rejected ideas explicitly labeled; never blur them into the
  shipped surface.
- Run `npx vitest run` and `go test ./...` in `compiler/` before claiming
  success.
