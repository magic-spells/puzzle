---
name: Build flow
status: verified
triggers:
  - { kind: manual }
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-WATCH
  - FILE-BUILD-PRERENDER
verified_at: '2026-07-22T00:04:06.540Z'
notes: []
---

# Build flow

Both production and development builds use one compiler pipeline:

`puzzle build [dir]` / `puzzle dev [dir]` →
[[COMPONENT-COMPILER-CLI]] → build orchestration → esbuild with
[[COMPONENT-ESBUILD-PLUGIN]] → section parsing
([[COMPONENT-TEMPLATE-PARSER]]) → render emission ([[COMPONENT-CODEGEN]]) →
runtime bundle.

## Production build

1. Validate config and public assets before touching the existing output.
   Generated names are reserved case-insensitively so public files cannot
   overwrite `app.js`, its map, or `styles.css`. The guard is root-level only:
   nested files with those names, `index.html`, and other assets copy fine
   (guarded by `TestBuildAllowsNestedReservedNames`).
2. Compile every reachable `.pzl` module. User `<scripts>` stays JavaScript;
   TypeScript mode is transpile-only.
3. Compose `styles.css` from the optional Tailwind layer and collected component
   styles in deterministic order.
4. Copy public assets and write the bundle into a staging directory.
5. When static output is enabled, [[COMPONENT-SSG]] prerenders eligible routes.
6. Atomically replace `dist/`. A failed build leaves the last good output intact.

Default production output is minified ES2022 ESM with linked source maps and
console calls removed unless config opts out.

## Development build

[[COMPONENT-DEV-SERVER]] performs an initial development build, then keeps an
incremental esbuild context and a warm Tailwind process while recursively
watching `app/`. Successful debounced rebuilds broadcast SSE reloads; failed
rebuilds report the error and keep serving the last good output. The reload
client is injected while serving `index.html`, never written into production
artifacts.

The dev-state runtime snapshots store records and JSON-safe local view state
before reload, then restores the store before navigation and local state after
mount. Production bundles tree-shake that path.

## Failure contract

Parser, codegen, config, style, asset, and prerender failures are surfaced with
actionable context and fail the build. No lane silently substitutes empty CSS,
partial component output, or a half-written `dist/`.
