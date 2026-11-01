---
name: Compiler design
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - COMPONENT-COMPILER-CLI
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-FORMATTERS
  - FLOW-BUILD
  - FILE-CODEGEN
  - FILE-ESBUILD-PLUGIN
---

# Compiler design

The contributor's map of how a `.pzl` file becomes JavaScript and an app becomes `dist/`. Each
stage's contract lives in its own card; this one says how they fit and which rules hold across
all of them.

## The lane

`puzzle build` / `puzzle dev` ([[COMPONENT-COMPILER-CLI]]) drive esbuild with the `.pzl`
plugin ([[COMPONENT-ESBUILD-PLUGIN]]). `app/app.ts` or `app/app.js` is the entry; its imports
discover routes, models and `.pzl` files, and `@/` resolves to `app/`. For each imported
`.pzl` the plugin runs:

1. **Sections and template** — [[COMPONENT-TEMPLATE-PARSER]] (`packages/puzzle-lang/parser`)
   splits `<puzzle-view>`, `<script>`, `<style>` and `<puzzle-skeleton>` and parses the
   template, every expression going through the closed grammar in `packages/puzzle-lang/expr`
   ([[DECISION-D176-EXPRESSION-LANGUAGE]]).
2. **Emission** — [[COMPONENT-CODEGEN]] keeps the script bytes, adds one import line and
   appends `Name.prototype.render` (and `renderSkeleton`)
   ([[DECISION-D10-PROTOTYPE-RENDER]]).
3. **Bundling** — esbuild owns JavaScript/TypeScript parsing, imports, aliases, source maps,
   minification, console stripping, CSS collection and scoping, the function manifest
   ([[COMPONENT-FORMATTERS]]) and dependency discovery. The Go template compiler duplicates
   none of it ([[DECISION-D09-GO-ESBUILD-COMPILER]]).

The build around it — usage scan, Tailwind, staging, prerender, atomic swap, the dev loop — is
[[FLOW-BUILD]]; flags and output modes are [[DOC-SPEC-BUILD]].

## Rules that hold across the lane

- **The `<script>` is real JavaScript or TypeScript.** Go tokenizes it to find the class and
  check reserved bindings, but never parses or rewrites it; TypeScript is transpile-only
  ([[DECISION-D54-TYPESCRIPT-SCRIPTS]]).
- **Templates never reach script scope**, with one exception: `<Component is>` may read the
  script's imports and simple module declarations
  ([[DECISION-D180-COMPONENT-SLOT]]). Every other expression reads `data()`.
- **Text is text.** Interpolations become text nodes through the runtime's `displayValue`
  ([[DECISION-D127-DISPLAY-COERCION-OWNER]], [[DECISION-D22-NO-ESCAPE-BY-DEFAULT]]); markup
  enters only through `{#svg}` ([[DECISION-D46-INLINE-SVG]]) and the sanitized `raw()` /
  escaped `newline_to_br()`.
- **The emitted module imports only what it uses**, so opt-in runtime features cost nothing in
  apps that don't write them.
- **No partial output.** Parser and codegen errors carry file, line, column and an actionable
  message and surface as esbuild errors; a failed build keeps the last good `dist/`.
- **Prerendering is a build-time document optimization**: `hybrid` and `static` output run the
  same compiled views in Node. There is no SSR server and no hydration protocol.

## Proof

Go table tests cover the scanner, parser and codegen; golden fixtures pin byte-level emission
(the todos output is the byte contract); Vitest compiled-fixture suites prove generated modules
behave like real views; example builds and the Playwright smoke exercise the whole lane.
