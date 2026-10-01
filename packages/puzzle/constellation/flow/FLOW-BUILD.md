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
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Build flow

`puzzle build [dir]` / `puzzle dev [dir]` → [[COMPONENT-COMPILER-CLI]] → build
orchestration → esbuild with [[COMPONENT-ESBUILD-PLUGIN]] → section parsing
([[COMPONENT-TEMPLATE-PARSER]]) → render emission ([[COMPONENT-CODEGEN]]) → bundle.

## Production build

1. Runtime preflight, sweep stale transient dirs, load config, and validate public assets
   before touching existing output. Generated names (`app.js`, its map, `styles.css`, and
   `chunks/` when splitting, [[DECISION-D160-SPA-CODE-SPLITTING]]) are reserved
   case-insensitively at the public ROOT only — nested files with those names copy fine
   (`TestBuildAllowsNestedReservedNames`).
2. Run the usage scan once and hand it to every pass (`passContext`).
3. Bundle the entry (`app/app.ts` or `app/app.js`), compiling each reachable `.pzl`
   through the build-scoped compile cache
   ([[DECISION-D152-BUILD-SCOPED-COMPILE-CACHE]]); `<script>` bytes stay as authored
   (TypeScript is transpile-only). Tailwind runs concurrently; browser errors are
   reported before Tailwind errors.
4. Compose `styles.css` (Tailwind output, then collected component styles, deterministic
   order).
5. Copy public assets and write the bundle (split into `chunks/` when `build.splitting`
   is on) into staging under `.puzzle/tmp/` ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]).
6. For `hybrid`/`static` output, bundle for Node and run [[COMPONENT-SSG]] into staging.
7. Atomically replace `dist/` (the previous output is renamed into `.puzzle/tmp/`, then
   removed). A failed build leaves the last good output intact.

Production output is minified ES2022 ESM with linked source maps and console calls
removed unless config opts out.

## Development build

[[COMPONENT-DEV-SERVER]] runs an initial build, then keeps an incremental esbuild context
and a warm Tailwind process while watching `app/` and `public/`. Each batch is classified
so usage, public and CSS work runs only when that batch can affect it
([[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]]); successful rebuilds broadcast SSE reloads,
failed ones report and keep serving the last good output. Static projects rebuild through
the warm static builder with route-level invalidation. The reload client is injected at
serve time, never written into artifacts. The dev-state runtime
([[COMPONENT-DEVSTATE]]) carries store records and local view state across the reload.

## Failure contract

Parser, codegen, config, style, asset and prerender failures surface with actionable
context and fail the build. Nothing silently substitutes empty CSS, partial component
output, or a half-written `dist/`.
