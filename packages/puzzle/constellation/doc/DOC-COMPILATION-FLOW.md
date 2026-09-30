---
name: Compilation and build flow
status: built
connections:
  - DOC-SPEC
  - DOC-COMPILER-DESIGN
  - FLOW-BUILD
  - COMPONENT-COMPILER-CLI
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-SSG
  - COMPONENT-DEV-SERVER
---

# Compilation and build flow

The contributor trace from a Puzzle app to `dist/`. [[FLOW-BUILD]] holds the
guarantees; [[DOC-COMPILER-DESIGN]] the parser/codegen internals;
[[DOC-APP-STRUCTURE]] the project layout. `app/app.ts` or `app/app.js` is the
esbuild entry; its imports discover routes, models and `.pzl` files, and `@/`
resolves to `app/`.

## Pipeline

1. Resolve the project and config, validate the mode, and reject reserved
   public output names before pruning anything.
2. Create esbuild options and install the `.pzl` plugin.
3. For each imported `.pzl`: split sections, parse the template, emit the
   unchanged script plus its `Name.prototype.render` assignment.
4. esbuild resolves and bundles the module graph, including the runtime and
   any TypeScript.
5. Tree-shake the function registry to the names templates actually call
   (the virtual `@magic-spells/puzzle/formatters/manifest` module).
6. Compose Tailwind output and collected component styles; `<style scoped>`
   is wrapped in native `@scope`.
7. Copy public files and locale files, and write JS, CSS and assets into a
   staging directory.
8. For `hybrid`/`static`, run the prerender bundle over eligible routes and
   serialize route HTML and `404.html`.
9. Atomically swap staging into `dist/`. Any failure keeps the last good
   `dist/`.

Codegen never rewrites the user's class; the output carries source mapping
and the imports generated nodes need.

## Modes

- `puzzle build` — production ES2022 ESM, minified, console calls stripped by
  default, linked source map only with `build.sourceMap: true`.
- `puzzle build --mode development` — one readable development build.
- `puzzle build --hybrid` / `--static` — the SPA plus prerendered pages it
  takes over, or true static pages with a per-page mount module and no
  `app.js`.
- `puzzle dev` — incremental build, recursive watch, server, state-preserving
  SSE reload; serves per output mode.

Prerendering is a build-time document optimization: there is no SSR server
and no hydration protocol.
