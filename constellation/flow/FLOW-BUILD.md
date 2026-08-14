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
verified_at: '2026-08-14T05:01:18.453Z'
notes: []
verified_sha: d74916a0e021b6bb86394551171838fbab161347
---

# Build flow

Both production and development builds use one compiler pipeline:

`puzzle build [dir]` / `puzzle dev [dir]` →
[[COMPONENT-COMPILER-CLI]] → build orchestration → esbuild with
[[COMPONENT-ESBUILD-PLUGIN]] → section parsing
([[COMPONENT-TEMPLATE-PARSER]]) → render emission ([[COMPONENT-CODEGEN]]) →
runtime bundle.

## Production build

1. Sweep stale transient directories, then validate config and public assets
   before touching the existing output. Generated names are reserved
   case-insensitively so public files cannot overwrite `app.js`, its map,
   `styles.css`, or — with splitting on — the `chunks/` directory
   ([[DECISION-D160-SPA-CODE-SPLITTING]]). The guard is root-level only:
   nested files with those names, `index.html`, and other assets copy fine
   (guarded by `TestBuildAllowsNestedReservedNames`).
2. Compile every reachable `.pzl` module through the build-scoped compile
   cache ([[DECISION-D152-BUILD-SCOPED-COMPILE-CACHE]]). User `<script>` stays
   JavaScript; TypeScript mode is transpile-only.
3. Compose `styles.css` from the optional Tailwind layer and collected component
   styles in deterministic order.
4. Copy public assets and write the bundle — split into `chunks/` when
   `build.splitting` is on — into a staging directory under `.puzzle/tmp/`
   ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]).
5. When static output is enabled, [[COMPONENT-SSG]] prerenders eligible routes.
6. Atomically replace `dist/` (the previous output is renamed into
   `.puzzle/tmp/` before removal). A failed build leaves the last good output
   intact.

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

## D156 performance hardening

[[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]] keeps this failure contract while
overlapping browser compilation with Tailwind generation. A barrier preserves
browser-before-Tailwind error priority; CSS composition, public copying, and
prerendering remain ordered afterward. The SPA watch path classifies each
changed batch so usage, public, and CSS work runs only when that batch can
affect it; an unimported public-only batch mirrors without invoking esbuild.
