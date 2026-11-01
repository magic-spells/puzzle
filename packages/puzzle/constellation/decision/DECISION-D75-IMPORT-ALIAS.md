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
  - DECISION-D67-HYBRID-PRERENDER
verified_at: '2026-11-01T19:23:12.785Z'
code_refs:
  - compiler/internal/build/options.go
  - compiler/cmd/puzzle/initcmd.go
  - compiler/internal/scaffold/scaffold.go
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D75 — The `@` app import alias

`@/…` in any bundled import specifier resolves to `<project root>/app`: `import Icon from '@/components/Icon.pzl'` works from any depth. Always on, zero config; relative imports are unchanged. Spec: [[DOC-SPEC-ANATOMY]] §40.

## Decision

- **Fixed `@` → `app/`**, one entry in esbuild's `Alias` map set in `configureRuntime` (`compiler/internal/build/options.go`), which every bundle (app, prerender, static) funnels through. Not configurable — `app/` is already framework-fixed.
- **Safety:** esbuild alias keys match only at segment boundaries, so a bare `@` key never captures `@magic-spells/puzzle` or any scoped package; npm can't publish a package named `@`. `alias_test.go` guards the scoped-package case.
- **Module resolution only.** `{#svg '…'}` asset paths and CSS `@import`s use other resolvers and are untouched.
- **Editors are wired by `puzzle init`:** `"paths": { "@/*": ["./app/*"] }` in `tsconfig.json` (TypeScript) or an editor-only `jsconfig.json` (plain JS) — never both, since editors ignore `jsconfig.json` beside a `tsconfig.json`. The compiler reads neither (D3).

## Alternatives rejected

- **Anchor `@` at the project root** — every import would carry `app/`, and `@` could reach `dist/`/`node_modules/`.
- **`~/`, `$app`, `#app`** — `@/` is what the audience already types; `#app` needs a per-app `package.json` `imports` block.
- **Configurable `resolve.alias` in `puzzle.config.js`** — not built; a real case (e.g. monorepo `@shared/*`) could layer onto the same map.
