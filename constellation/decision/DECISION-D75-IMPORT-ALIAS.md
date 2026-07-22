---
name: 'D75 — The `@` app import alias (v1.42)'
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-USER-GUIDE
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D67-SSG-STATIC-BUILD
verified_at: '2026-07-21T21:31:58.788Z'
verified_sha: f29d1376409fcf854719ba0844073f51f7059e20
notes:
  - kind: verified
    text: >-
      Verified at merge (PR #49, merge f29d137): all Go packages green + 788/788 vitest on merged
      main. Resolution proven end-to-end, not just unit-tested — examples/chirp and examples/stays
      build with their converted '@/components/…' imports and the aliased component's markup lands
      in dist/app.js; `puzzle build --static` on examples/static-docs exercises the separate
      prerender BuildOptions; `puzzle dev` serves the aliased bundle (watch path). Renumbered from
      D73/§39/v1.40 during the merge — main had taken those for scroll-trigger animations (D73) and
      <children/> (D74) while the branch was open.
    sha: f29d1376409fcf854719ba0844073f51f7059e20
---

# D75 — The `@` app import alias (v1.42)

`@/…` in any bundled import specifier resolves to the app's `app/` directory: `import Icon from '@/components/Icon.pzl'` is `<project root>/app/components/Icon.pzl` from any file at any depth. Always on, zero config, additive — relative imports are unchanged. See [[DOC-SPEC]] §40.

## Context

Puzzle had no path aliasing of any kind. Every internal import was relative, which is fine while views are flat and starts hurting the moment they are not: `examples/chirp/app/views/profile/*` and `examples/stays/app/views/account/*` were already climbing `../../components/…`, and moving a file rewrites every specifier inside it. Developers arriving from React/Next/Vite reach for `@/components/…` reflexively and found nothing.

The enabling observation: the esbuild `Alias` map was already in the build (`compiler/internal/build/options.go`, `configureRuntime`) for the in-repo `@magic-spells/puzzle` runtime resolution, and both bundles — the app bundle and the D67 prerender bundle — funnel through that one function. The whole feature is one map entry in one place.

## Decision

**A fixed, built-in `@` → `<project root>/app`.** Not configurable, no `puzzle.config.js` key. `app/` is already framework-fixed — every build path hardcodes the entry as `app/app.js` — so there is nothing for a user to configure that would not immediately break the entry resolution too.

**Safety rests on esbuild's segment-boundary alias matching** (`internal/resolver`: a key matches when the specifier equals it or continues with `/`, longest key wins, package paths only). A bare `@` key therefore catches `@` and `@/…` and cannot swallow `@magic-spells/puzzle` or any other scoped package. npm cannot publish a package named exactly `@`, so the namespace is uncontested. This is asserted in `TestBuildResolvesAppAlias`, which builds an app whose every `.pzl` imports `PuzzleView` from the untouched scoped specifier.

**Module resolution only.** `{#svg '…'}` asset paths (§18, resolved against `app/assets` by the Go compiler) and CSS `@import`s go through different resolvers and are deliberately untouched — `@` there would mean three things in one codebase.

**Editors are wired by `puzzle init`, not by the build.** A `"paths": { "@/*": ["./app/*"] }` mapping goes into `tsconfig.json` (`--typescript`) or an editor-only `jsconfig.json` (plain JS) — exactly one of the two, since editors ignore a `jsconfig.json` next to a `tsconfig.json`. Consistent with [[DECISION-D03-SCRIPTS-REAL-JS]]: the compiler never reads either file, and no user JS is rewritten.

## Alternatives rejected

- **A configurable `resolve: { alias: {…} }` block in puzzle.config.js** — a config surface, a validation path, and a doc section to buy back a convention the framework already fixes. Deferred, not foreclosed: if a real case appears (a monorepo `@shared/*`), it layers on top of this map.
- **Anchoring `@` at the project root** — every import would then carry a redundant `app/` segment (`@/app/components/…`), and `@` would be able to reach `dist/`, `node_modules/`, and `package.json`. `app/` is the source root; the alias should mean "my source".
- **`~/` (Nuxt 2), `$app` (SvelteKit), `#app` (node imports-field)** — the imports-field spelling is the only one with a standards story, but it requires a `package.json` `imports` block per app and reads as an internal-package escape hatch. `@/` is what the target audience already types.
- **Doing nothing / documenting relative paths as the convention** — the friction is real and compounding, and the fix cost was one map entry.

## Consequences

Purely additive: no template grammar change, no codegen change, no runtime change; existing relative-import apps build byte-identically. `configureRuntime` was restructured so the alias map is always present (it previously assigned the map only on the in-repo runtime branch, so published apps got no map at all) and the runtime entries merge into it rather than replacing it. New tests: `compiler/internal/build/alias_test.go` (app bundle + the `--static` prerender bundle, plus the scoped-package regression guard) and a scaffold assertion for both editor config files.
