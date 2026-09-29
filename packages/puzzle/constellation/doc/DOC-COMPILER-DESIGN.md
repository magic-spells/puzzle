---
name: Compiler design
status: built
connections:
  - DOC-SPEC
  - DOC-COMPILATION-FLOW
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
  - FILE-ESBUILD-PLUGIN
---

# Compiler design

The compiler turns `.pzl` modules into ordinary JavaScript modules for
esbuild. Central constraint (D3): the user's `<script>` is real JavaScript,
and Go never parses or rewrites its semantics.

## Sections and template parser


[[COMPONENT-TEMPLATE-PARSER]] lives in `packages/puzzle-lang`. Every file
holds one `<puzzle-view>` section (the template), optional `<script>` and
`<style>`, and an optional `<puzzle-skeleton>`; order is free, and a
duplicate, missing or malformed section fails with a source position. In
view mode `<puzzle-view>` becomes the render root with its attributes; in
component mode it renders nothing and its content must be one root. The
section splitter is aware of strings, comments, regexes, template literals
and `{#raw}` spans, so tag-like text inside them never ends a section.

The parser builds an AST of host and component tags, attributes,
interpolations, control-flow blocks, events, composition markers, `{#svg}`,
`{#raw}`, islands and refs. Every expression is parsed by the closed
expression grammar in `packages/puzzle-lang/expr` (D176). Block closure is
structural. Attribute values have their own mixed text/interpolation grammar;
an inline `{#if}` there may not contain elements or `{#for}`. The parser
enforces marker spelling and placement, static ref/slot/island names,
component and event forms, and directive nesting; single-root arity is a
codegen gate.

## Code generation

[[COMPONENT-CODEGEN]] keeps the script body byte-for-byte and appends
`Name.prototype.render = function () { … }` (plus `renderSkeleton`). The
class name is the first real `export default class X extends …` in the
string/comment/regex-aware token stream; an anonymous default export or a
missing `extends` is a build error. Render code builds ViewNode trees and
resolves identifiers against loop and event scope before component data.

Emission contracts:

- **Reserved module-scope names.** The appended imports and declarations make
  these names compiler-owned in a script: `ViewNode`; `SLOT_TAG`,
  `SNIPPET_TAG`, `PORTAL_TAG` (when used); `__s` (display coercion); `__l`
  (list blocks), `__L<n>` (list-block metadata), `__e` / `__r` (loop guards);
  `__svg_N` (shared `{#svg}` assets). Binding one at module scope is a
  positioned compile error (D133), found by a conservative top-level
  declaration scan that never parses the script; misses fall through to
  esbuild's duplicate-binding error. Function-scope scratch names (`__d`,
  `__f`, `__ev`, `__i`, …) are not reserved — they only shadow. An alias
  allocator stays rejected.
- **Library calls.** `const __f = this.ctx.formatters.getAll()` is emitted only
  when a template calls a library function; each call goes through
  `(__f["name"] || __f.__missing("name"))` (the D43 guard).
- **Display coercion.** Interpolations route through the runtime's
  `displayValue` as `__s(…)` (D127): the runtime owns the rule, `null` and
  `undefined` print empty, and `undefined` warns once in development only.
  Text nodes give structural injection safety.
- **Caching (D170).** Data-independent handlers and ref setters are cached per
  instance; an item-form `{#for}` lowers to a persistent list block with
  row-scoped handler caches; maximal static subtrees are allocated once.
- List rows get primary-key-aware automatic keys unless `key` overrides.
- Conditionals emit placeholders to keep sibling arity stable.
- Component children, named slots, snippets and router outlets share one
  composition mechanism under distinct spellings.

## Bundler boundary

[[COMPONENT-ESBUILD-PLUGIN]] owns JavaScript/TypeScript parsing, imports, the
`@/` alias, runtime aliases, source maps, minification, console stripping, CSS
collection and scoping, the function manifest, and dependency discovery. The
Go template compiler duplicates none of it.

## Errors and proof

Parser and codegen errors carry file, line, column and an actionable message,
surface as esbuild errors, and never produce partial output. Go table tests
cover the scanner, parser and codegen; golden fixtures pin byte-level
emission; Vitest compiled-fixture suites prove generated modules behave like
real views; example smoke builds exercise the whole lane.
