---
name: Compiler design
status: verified
verified_at: '2026-07-22T01:03:41.854Z'
verified_sha: 5f16d58d1472c1c1f8f4266e9cc4c0ae40ad14d1
connections:
  - DOC-SPEC
  - DOC-COMPILATION-FLOW
  - DOC-DECISIONS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
  - FILE-ESBUILD-PLUGIN
---

# Compiler design

The compiler translates `.pzl` component modules into ordinary JavaScript
modules for esbuild. Its central constraint is D3: user `<scripts>` is real
JavaScript and the Go compiler never rewrites its semantics.

## Section extraction

A file contains one `<puzzle-view>`, optional `<scripts>` and `<styles>`,
and an optional `<puzzle-skeleton>`. The section scanner is aware of quoted
strings, comments, regular expressions, and template literals so tag-like text
inside JavaScript does not end a section early.

The parser reports source positions from the original file. Duplicate,
misordered, missing, or malformed top-level sections fail compilation.

## Template parser

[[COMPONENT-TEMPLATE-PARSER]] produces an AST for host/component tags,
attributes, interpolation/formatter expressions, control-flow blocks, events,
composition markers, inline SVG, comments, islands, and refs.

Balanced scans are quote/paren/brace aware. Block closure is structural, so
closing text inside strings or nested expressions is not mistaken for template
syntax. Attribute values have their own mixed-text/interpolation/conditional
grammar; an inline `{#if}` there may not contain elements or `{#for}` (parse
error).

The parser validates boundaries that are cheapest to enforce structurally:
one root, legal marker spelling/placement, static ref/slot/island names,
component/event forms, and directive nesting.

## Code generation

[[COMPONENT-CODEGEN]] preserves the user's script body, discovers the exported
class name without parsing JavaScript — from the line-anchored
`export default class X extends …` declaration, so an anonymous default export
is a build error — and appends a prototype render assignment. Generated render code constructs ViewNode trees and resolves
identifiers against lexical loop/event scope before falling back to component
data.

Notable emission contracts:

- text interpolation uses `String(value)`; DOM text nodes provide structural
  injection safety;
- formatter calls use the tree-shaken runtime map and the missing-formatter
  guard;
- data-independent handlers and ref setters are cached per instance;
- list records receive primary-key-aware automatic keys unless an explicit
  `key` overrides them;
- conditional branches emit placeholders where needed to keep sibling arity
  stable;
- component children, named slots, and router outlets share vnode composition
  machinery while keeping distinct source spellings;
- skeleton render functions reuse the component scope/root contract.

## Bundler boundary

[[COMPONENT-ESBUILD-PLUGIN]] owns JavaScript/TypeScript parsing, imports,
`@/` alias resolution, runtime aliases, source maps, minification, console
stripping, CSS collection/scoping, formatter manifests, and dependency graph
discovery. The Go template compiler does not duplicate those jobs.

## Errors and proof

Parser and codegen errors include file, line, column, and an actionable
message, then surface as esbuild errors. Compilation never substitutes partial
output.

Go table tests cover scanner/parser/codegen behavior; golden fixtures prove
byte-level emission where shape matters. Vitest compiled-fixture suites prove
that generated modules behave like real Puzzle views. Example smoke builds
exercise the complete plugin and build lane.
