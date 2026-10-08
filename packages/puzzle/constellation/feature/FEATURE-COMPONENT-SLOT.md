---
name: Runtime selection from imported components
status: built
release: RELEASE-V0-9-0
change: breaking
branch: feat/component-slot
connections:
  - DECISION-D180-COMPONENT-SLOT
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - DOC-LANGUAGE-CORE
  - DOC-RELEASE-SURFACE
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - FILE-CODEGEN
  - FILE-VIEW-NODE
  - FILE-VIEW-MANAGER
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-RUNTIME-ENTRY
  - TEST-COMPILER-CODEGEN
  - TEST-RUNTIME-LIFECYCLE
  - PLAN-PROJECT
  - RELEASE-V0-9-0
  - DECISION-D167-COMPONENT-FAMILIES
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DOC-COMPILER-DESIGN
  - DOC-RUNTIME-KERNEL
  - DOC-PUZZLE-FILE
  - COMPONENT-ESBUILD-PLUGIN
  - TEST-DOM-PATCHING
  - TEST-COMPOSITION-MARKERS
  - TEST-PRERENDER-OUTPUT
  - FILE-COMPONENT-SLOT
  - FILE-CODEGEN-COMPONENT
  - FILE-CHECK-COMPONENT
  - DECISION-D173-CORE-SEMANTICS
  - FILE-CODEGEN-LOWER
---

# Runtime selection from imported components

## Intent

Render one of a finite, imported set of compiled Puzzle components using the same prop invocation, while preserving normal component teardown and tree-shaking. [[DECISION-D180-COMPONENT-SLOT]] owns the contract.

## Scope

- One form: `<Component is={ current }>`; map lookup is ordinary `is={ cards[key] }`.
- Children are normal default-slot content; nullish selection renders nothing.
- Reactive props, events and ordered attribute spreads; `null`/`undefined` selection is empty.
- Reserved `Component` tag/family diagnostics with a rename hint; no component `bind:` syntax, global registry or lazy module resolution.
- Compiler, runtime, prerender, parser/tooling ports and editor recognition; guide and embedded agent skill.

## Acceptance

Compile coverage includes missing/non-expression `is`, reserved user names, ordinary forwarded `name`/`from` props and emitted import-bounded selection. Runtime coverage checks swap cleanup and listener/subscription ownership, current props across swaps, events, indexed-map expressions, null selection and nested selections. Both prerender modes serialize selected content or nothing. Every affected package's suites and lint pass, examples still build, and the requested focused commit-plan script exists; no commit, push, tag or publish is performed.
