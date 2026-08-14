---
name: Puzzle
verified_at: '2026-07-25T05:26:06.874Z'
status: verified
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
notes:
  - kind: verified
    text: >-
      Current-state section rewritten: it ran out at D90/v1.54 and still called D100 "IN PROGRESS"
      on a branch. Now reads through D111, splits published vs working 0.2.0, and records that the
      DevTools framework bridge is merged while the extension repo is unstarted. Added the
      deep-review-round paragraph and the SKILL.md refresh as the named pre-0.2.0 blocker.
    sha: 35e8fd092a8e4559269fd8578a419e69e8371f6c
---

# Puzzle project map

Puzzle is a SPA-first JavaScript framework with `.pzl` single-file components,
a reactive browser runtime, and a Go + esbuild compiler/CLI. Optional static
generation prerenders routes without adding an SSR server or hydration layer.

[[DOC-SPEC]] is the enforceable contract and wins all conflicts. The
decision cards explain why the contract has its current shape.
[[DOC-RELEASE-SURFACE]] is the concise inventory of everything that ships.

## Current state

- **Published:** `0.1.0` (2026-07-21), `0.1.1` (interactive `puzzle init`
  prompts, D77/v1.44), and `0.1.2` (the embedded agent skill + `puzzle add
  skills` installer, D78/v1.45) are live on npm — MIT, five packages, manual
  publish, no CI release path.
- **`0.2.0`, `0.3.0`, and `0.3.1` are PUBLISHED.** `0.3.0` shipped without registry
  `optionalDependencies`, so every global CLI install was broken; it is
  deprecated and superseded by `0.3.1`, which publishes the same feature set
  from the packed root tarball so the four platform binary pins reach the
  registry (D120). `0.2.0` (2026-07-24) introduced the D67
  prerendered-SPA mode rename to `output: 'hybrid'` / `--hybrid`, path-shaped
  links, and true static-pages output.
- **The `0.3.0` / `0.3.1` feature set.** Minor, not patch, for two independent
  reasons: two new export subpaths (`./testing`, `./fixtures`) and three genuine
  breaking changes against a released consumer — D111 (the runtime no longer
  syncs managed head tags), D110 (`dev.proxy: { '/': … }` was working in 0.2.0
  and is now a config error that fails `dev` AND `build`), and D112 (a
  type-variant duplicate pk now
  throws from `createRecord` instead of silently creating a shadow record). Two
  softer behavior changes existing apps will notice: D93 moves focus and
  announces on every navigation (`focusBehavior: false` opts out) and D90 takes
  the next free port instead of failing (`--strict-port` opts out).
  Also in `0.3.0`: D113's prerender RAWTEXT rule — the SSG serializer stops
  entity-escaping `<script>`/`<style>` text, which had been corrupting
  prerendered JSON-LD into `&amp;` garbage for exactly the crawlers D111 makes
  the sole audience, and breaking `a > b` selectors in prerendered `<style>`.
  And D114's calendar-date rule — the change with the broadest user-visible
  surface in the release: a bare `YYYY-MM-DD` through the date formatters is a
  calendar date, parsed at local midnight so `date`/`timeago` read it as
  written in every viewer zone (the ES spec's UTC-midnight parse rendered it a
  day early for viewers west of UTC); `in_timezone` passes a calendar date
  through untouched, since a day names no instant to re-express. Smaller
  output change from the same round: `reverse` iterates strings by code
  point, so emoji/astral text reverses correctly instead of tearing
  surrogate pairs. The pre-publish review round added D115–D119 (mount-failure
  recovery, pack-time pin verification, static history-hrefs, lifecycle hook
  containment + mount epoch, router settlement/announcement).
- **`0.4.0` is PUBLISHED** (2026-07-28): the performance
  round (D121/D122 profiler + DevTools protocol), the Grok review rounds
  (D132/D133), D134 capitalized composition markers with marker fallback
  bodies (D141), and the D135–D143 hardening set.
- **`0.5.0` is PUBLISHED** (2026-08-07, the current `latest`,
  `verify:published`-clean): D144 `<Portal>` scoped v1
  (v1.66), D145 error boundaries (v1.67), D146 transactional reused-ancestor
  refresh, D147 implicit two-way form binding
  ([[FEATURE-IMPLICIT-BINDING]], v1.68), and D148 `puzzle preview` + real
  static serving in dev ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]], v1.69).
  A pre-merge review round on the binding branch also landed
  [[DECISION-D149-COMPUTED-GETTER-COLLISIONS]] (a payload key colliding with a
  computed getter is dropped and warned, not thrown on) plus correctness
  amendments with no product-line entry of their own: the bind write-back's
  `refresh()` now enters the D145 funnel, `ViewManager.render()` honours
  `treeUnknown`, a controlled `checked` keeps its content attribute coherent,
  and a view the router restores after a stalled out-animation is reactive
  again (and inert again when it truly leaves).
  `examples/overlays` is the Portal showcase (toasts, clipped-ancestor menu
  with `@event:outside` logical containment, Portal slide-over vs native
  `<dialog>` modal); its dogfooding pass produced the Portal
  component-root steering error (wrapper idiom documented in D144).
- **Next minor:** [[DECISION-D150-RAW-TEMPLATE-BLOCK]] adds the static
  `{#raw}…{/raw}` lex-off block for author-written braces while preserving
  ordinary HTML parsing and the existing parent-aware SSG RAWTEXT policy.
- **0.6 errorView amendment (v1.71, breaking):**
  [[DECISION-D145-ERROR-BOUNDARIES]] rewritten — error fallback UI is one
  app-level `errorView` compiled view with `{ error, info, retry }` props;
  per-view `errorContent()`/ViewNode authoring removed, retry re-runs the
  normal navigation/refresh pipeline, `boundary` phase renamed `error-view`.
  Byte-neutral by measurement; adopted as an API simplification.
- **Current 0.6 compiler hardening:**
  [[FEATURE-BUILD-PIPELINE-PERFORMANCE-HARDENING]] / [[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]]
  pins the restored SPA startup boundary, removes unrelated warm-rebuild work,
  adds dev phase profiles, and overlaps side-effect-safe one-shot phases while
  keeping prerender execution and atomic output behind a success barrier.
- **Current 0.6 adapter work (v1.72–v1.73):**
  [[DECISION-D157-ADAPTER-SUBPATH]] moves server sync behind the opt-in
  `@magic-spells/puzzle/adapter` capability. [[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]
  makes each model adapter a set of per-verb fetch functions: endpoint shorthand
  generates REST defaults, author verbs win, enhanced fetch carries auth and
  fixture interception, and framework reconciliation stays transport-agnostic.
- **Current 0.6 bundle work (v1.75):** [[DECISION-D160-SPA-CODE-SPLITTING]] /
  [[FEATURE-SPA-CODE-SPLITTING]] make a dynamic `import()` a lazy chunk under
  `dist/chunks/` behind `build: { splitting: true }` — default off, forced off
  in static mode, pruned across dev rebuilds — and add a per-dependency
  composition report to the build size banner. Phase 2 (lazy route views) is a
  separate design.
  The next free decision number is D161.
- What shipped in `0.2.0`, in order:
  - Mode-agnostic path-shaped links — `router.url()` + the built-in `link`
    formatter (D79/v1.46) — and the true static-pages output mode
    (`output: 'static'` / `--static`, D81/v1.47).
  - The 2026-07 ergonomics round, zero new template grammar across all five:
    compiler a11y warnings (D82/v1.48), router query snapshot + `replace()`
    (D83/v1.49), route head management (D84/v1.50), FLIP keyed-reorder
    animation via a `flip` attribute (D85/v1.51), and the `@event:outside`
    modifier (D86/v1.52 — Cory's design; document-capture outside-dismiss,
    retiring the pattern 16 puzzle-pieces hand-roll). Then route guards
    (D87/v1.53 — the inherited `guard` route field) and the dev-server port
    scan (D90/v1.54 — next free port instead of failing on a busy one,
    `--strict-port` to opt out).
  - The framework-gap round (see the section below): D91-D98, plus the
    build-time tree-shaking work (D88 sourcemap opt-out, D89 feature-usage
    defines).
  - Agent-skill upgrade ergonomics: D97 (post-`upgrade` refresh offer) and
    D99 (`add skills` asks instead of refusing; `puzzle upgrade skills`).
  - The DevTools runtime bridge (D100, SPEC §55) — merged and suite-verified;
    the extension itself is a separate repo and still to be written.
  - A deep-review hardening round (D110 `dev.proxy` prefix validation, D111
    managed head tags build-time only) plus the un-carded fixes it carried:
    hybrid prerender URLs now share the router's one encoder, an enter-hook
    throw no longer tears down a mounted component, Store hydration is
    genuinely fail-soft, island validation descends into slot fallback, the
    lexer no longer panics on a trailing backslash, and generated static-page
    entries observe their own mount rejection.
- Element actions and lazy routes were reviewed and deferred (the SPEC deferred
  list carries the rationale). `<Portal>` shipped its scoped v1 in 0.5.0
  ([[DECISION-D144-PORTAL]], v1.66) — named outlets remain the deferred half. Pieces migration to
  `@event:outside` is queued for AFTER 0.2.0 ships — older compilers reject
  unknown modifiers.
- `examples/kanban` drives its drag-shift animation from the `flip` attribute
  rather than hand-rolled `beforeUpdate`/`afterUpdate` rect snapshots;
  `examples/kanban-morph` still carries the manual version.
- Runtime, compiler, CLI, static generation (hybrid + static modes),
  state-preserving dev reload,
  TypeScript transpilation, model validation/relationships/write sync, nested
  routing, slots, refs, scoped styles, animations, and optional morphs are all
  implemented.
- The npm package includes the JavaScript runtime/types, the `puzzle` shim, and
  optional macOS/Linux binaries for arm64/x64.
- `examples/todos` is the canonical integration app. The rest of `examples/`
  are focused acceptance/showcase apps.
- The 0.1.x backlog is done and published, `0.2.0` shipped 2026-07-24, and the
  `skills/puzzle/SKILL.md` refresh landed with it (checklist item 1b below
  stays a recurring per-release step). Launch assets (demo links, announcement)
  remain open around the `0.3.1` launch.

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
generated wrapper entry; `/fixtures` imports the opt-in `/adapter` runtime and
replaces its `Store._network` seam, while core carries neither module).

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

The DevTools work (D100, 2026-07-24) shipped **both halves**. The framework
half is merged and suite-verified: `client-runtime/devtools.js` speaks SPEC
§55's wire protocol, registers only when an extension injects
`window.__PUZZLE_DEVTOOLS_HOOK__`, and DCEs out of production entirely. The
extension lives in its own public repo `magic-spells/puzzle-devtools` (MV3,
panel UI dogfooded as a Puzzle app), unit-tested and smoke-verified against a
live `puzzle dev` app in real Chrome. Its panels are Views, Store,
Subscriptions, Router, Performance, and Connection. The store's
`subscribersByKey`/`keysBySubscriber` pair is the asset — it answers "which
views re-render when this record changes" exactly, which React and Svelte users
answer by guessing; the Subscriptions panel reads it through
`snapshot:subscriptions` and re-requests on each `flush`. That snapshot
separates `held` keys — those a prepared, uncommitted `data()` run added
([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]) — so an open navigation does
not read as a leak.

A **deep-review round** followed (2026-07-24), reading the merged tree rather
than adding features. It produced two decision cards — D110 (`dev.proxy` rejects
a root prefix and duplicate routes at config load, both of which previously
crashed or silently broke `puzzle dev`) and D111 (managed head tags become
build-time only; the runtime `syncTags`, its router call site, and the whole
`__PUZZLE_HAS_HEAD_TAGS__` gate are deleted) — plus a set of correctness fixes
that needed no new contract. The recurring theme worth remembering: three of
them were **duplicated logic that had drifted** (three copies of the URL
encoder, a byte-copy of `normalizeBase`, a usage probe set that had fallen out
of step with `MANAGED_TAGS`), and two were **fail-soft paths that were not**
(Store hydration escaping the constructor, an enter-hook throw reaching the
mount-failure recovery).

Identified and **not** scheduled, roughly by value (error boundaries + the app
`onError` hook shipped in 0.5.0 — [[DECISION-D145-ERROR-BOUNDARIES]]): dynamic
components (`<component is={}>`); `<KeepAlive>`-style view-state retention on
back-navigation; a schema-derived forms helper (its substrate — implicit
two-way form binding, inferred with no sugar syntax — is in 0.5.0 as
[[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]/v1.68; the forms helper itself
stays unscheduled); `<svelte:window>`-style global event bindings;
per-subtree provide/inject;
`puzzle check` / an LSP over the compiler's existing positioned diagnostics;
i18n; `build --analyze`; deploy presets; Astro-style content
collections; and a WASM playground. (`puzzle preview` left this list in 0.5.0
— [[DECISION-D148-PREVIEW-AND-STATIC-DEV]]/v1.69. Dynamic components were
re-reviewed 2026-07-28 and stay cut: `{#if}`/`{#case}` over imported
components covers the enumerable case, and compile-time import resolution
makes an open-ended `is={}` real design work, not sugar.)

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
  Now the section index over six domain cards; `§N` numbers never move.
  - [[DOC-SPEC-ANATOMY]] — naming, config, `.pzl` anatomy, real-JS scripts,
    project layout, scoped styles, the `@` alias.
  - [[DOC-SPEC-TEMPLATE]] — template grammar, event handlers and modifiers,
    slots, islands, `{#svg}`, list keying, a11y warnings.
  - [[DOC-SPEC-VIEW]] — animations, skeletons, `memo()`, refs, `flip`, morphs,
    app lifecycle hooks.
  - [[DOC-SPEC-DATA]] — models, schema builders, store, validation,
    relationships, adapter read/write sync, fixtures.
  - [[DOC-SPEC-ROUTER]] — routing surface, nested chains, scroll, hash/memory
    modes, base path, transitions, atomic commit, head, guards, focus.
  - [[DOC-SPEC-BUILD]] — CLI, HMR, static/hybrid output, upgrade, dev build
    errors, `/testing`, `--fixtures`, the DevTools bridge.
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
- [[COMPONENT-DEVSTATE]] — development reload state transfer; also owns the
  live-view registry the DevTools bridge ([[FILE-DEVTOOLS]], D100) observes.
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
