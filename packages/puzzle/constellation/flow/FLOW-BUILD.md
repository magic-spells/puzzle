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
  - FILE-BUILD-SHELL
  - FLOW-DEV-REBUILD
  - FLOW-PRERENDER
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
verified_at: '2026-11-01T19:26:04.240Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Build flow

`puzzle build [dir]` / `puzzle dev [dir]` → [[COMPONENT-COMPILER-CLI]] → build
orchestration → esbuild with [[COMPONENT-ESBUILD-PLUGIN]] → section parsing
([[COMPONENT-TEMPLATE-PARSER]]) → render emission ([[COMPONENT-CODEGEN]]) → bundle.

## Production build

1. Runtime preflight, sweep stale transient dirs, load config, and validate public assets
   before touching existing output. Generated names (`app.js`, its map, `styles.css`;
   `chunks/` when splitting, [[DECISION-D160-SPA-CODE-SPLITTING]]; `locales/` with i18n)
   are reserved case-insensitively at the public ROOT only — nested files with those names
   copy fine.
2. With `build.hashNames` unset, read `public/` HTML to decide which fixed names the shell
   and other public pages still need ([[DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD]]).
3. Run the usage scan once and hand it to every pass (`passContext`). It walks the project,
   then the `.pzl` files of installed packages that declare `@magic-spells/puzzle`
   ([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]).
4. Bundle the entry (`app/app.ts` or `app/app.js`), compiling each reachable `.pzl` through
   the build-scoped compile cache ([[DECISION-D152-BUILD-SCOPED-COMPILE-CACHE]]);
   `<script>` bytes stay as authored (TypeScript is transpile-only). Tailwind runs
   concurrently; browser errors are reported before Tailwind errors. Each pass ends with
   the per-file usage check: a compiled `.pzl` the scan never read that needs a
   compiled-out feature or function fails the pass, before anything is swapped.
5. Compose the global stylesheet: Tailwind output, then collected component styles in
   deterministic order — `styles-<ContentHash>.css` when hashed, else `styles.css`.
6. Copy public assets and write the bundle (lazy chunks in `chunks/` under
   `build.splitting`) into staging under `.puzzle/tmp/`
   ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]).
7. In production, [[FILE-BUILD-SHELL]] rewrites the copied shell to the emitted entry/CSS
   names and inserts the entry's static-import modulepreloads. Under an explicit
   `hashNames: true` a missing entry reference fails here, before the swap; public files
   keep their names.
8. For `hybrid`/`static` output, bundle for Node and run [[COMPONENT-SSG]] into staging
   ([[FLOW-PRERENDER]]).
9. Atomically replace `dist/` (the previous output is renamed into `.puzzle/tmp/`, then
   removed). A failed build leaves the last good output intact.

Production output is minified ES2022 ESM with console calls removed unless config opts
out. Linked production source maps are opt-in.

## Development build

[[COMPONENT-DEV-SERVER]] runs an initial build, then keeps warm esbuild context(s) and a
Tailwind child while watching `app/` and `public/`; the sequence is [[FLOW-DEV-REBUILD]].
Development builds keep fixed names and add no preloads.

## Failure contract

Parser, codegen, config, style, asset and prerender failures surface with actionable
context and fail the build. Nothing silently substitutes empty CSS, partial component
output, or a half-written `dist/`.
