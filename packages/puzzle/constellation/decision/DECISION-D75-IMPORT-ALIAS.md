---
name: D75 — The @ app import alias
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - DOC-USER-GUIDE
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D67-SSG-STATIC-BUILD
verified_at: '2026-08-24T18:51:16.515Z'
code_refs:
  - compiler/internal/build/options.go
  - compiler/cmd/puzzle/initcmd.go
  - compiler/internal/scaffold/scaffold.go
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D75 — The `@` app import alias

`@/…` in any bundled import specifier resolves to `<project root>/app`:
`import Icon from '@/components/Icon.pzl'` works from any depth. Always on, zero
config; relative imports are unchanged. Spec: [[DOC-SPEC-ANATOMY]] §40.

## Decision

- **Fixed `@` → `app/`**, one entry in esbuild's `Alias` map set in
  `configureRuntime` (`compiler/internal/build/options.go`), which every bundle
  (app, prerender, static) funnels through. The map is always present; the
  in-repo runtime entries merge into it. Not configurable — `app/` is already
  framework-fixed.
- **Safety:** esbuild alias keys match only at segment boundaries (the specifier
  equals the key or continues with `/`), so a bare `@` key never captures
  `@magic-spells/puzzle` or any scoped package; npm can't publish a package named
  `@`. `alias_test.go` guards the scoped-package case.
- **Module resolution only.** `{#svg '…'}` asset paths and CSS `@import`s use
  other resolvers and are untouched.
- **Editors are wired by `puzzle init`:** `"paths": { "@/*": ["./app/*"] }` in
  `tsconfig.json` (TypeScript) or an editor-only `jsconfig.json` (plain JS) —
  never both, since editors ignore `jsconfig.json` beside a `tsconfig.json`. The
  compiler reads neither (D3).

## Alternatives

- **Configurable `resolve.alias` in `puzzle.config.js`** — deferred, not
  foreclosed; a real case (e.g. monorepo `@shared/*`) can layer on this map.
- **Anchor `@` at the project root** — rejected: every import would carry
  `app/`, and `@` could reach `dist/`/`node_modules/`.
- **`~/`, `$app`, `#app`** — rejected: `@/` is what the audience already types;
  `#app` needs a per-app `package.json` `imports` block.
