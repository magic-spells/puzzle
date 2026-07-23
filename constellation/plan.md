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
D1-D80 in [[DOC-DECISIONS]] explain why the contract has its current shape.
[[DOC-RELEASE-SURFACE]] is the concise inventory of everything that ships.

## Current state

- `0.1.0` shipped publicly on npm 2026-07-21; `0.1.1` (interactive `puzzle
  init` prompts, D77/v1.44) followed 2026-07-22 (MIT, five packages, manual
  publish). `0.1.2` shipped the embedded agent skill + `puzzle add skills`
  installer (D78/v1.45, published 2026-07-22). Working version `0.2.0`
  (versions bumped, unpublished): mode-agnostic path-shaped links —
  `router.url()` + the built-in `link` formatter (D79/v1.46) — and the true
  static-pages output mode — `output: 'static'` / `--static` (D80/v1.47),
  with the D67 prerendered-SPA mode renamed `output: 'hybrid'` / `--hybrid`
  (the breaking config rename is what makes this 0.2.0).
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
- FLIP animations for keyed reorders.
- D23 `setData` ergonomics papercut (`setData` re-running `data()` when it
  touches keys `data()` read; today pair `setData` with explicit `refresh()`).
- Height animations need explicit px — WAAPI cannot animate to `auto`.

## Release checklist

1. Keep README, CLAUDE, [[DOC-RELEASE-SURFACE]], and current-state component
   cards aligned with HEAD.
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
