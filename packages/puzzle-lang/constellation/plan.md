---
name: Puzzle Language
connected_repos:
  - name: puzzle
    path: ../puzzle
    description: >-
      The Puzzle framework plan (runtime, Go compiler, CLI) — owns COMPONENT-TEMPLATE-PARSER, the
      template-grammar decision cards, and DOC-SPEC
connections:
  - TEST-COMPILER-PARSER
---

# Puzzle Language

The plan for `packages/puzzle-lang`, the Go module
`github.com/magic-spells/puzzle/packages/puzzle-lang`: the Puzzle template
language shared by PuzzleKit and Magic Spells Sites (D172). It holds the
`parser` package (section splitter, lexer, recursive-descent template parser,
AST, positioned `ParseError`s), the `expr` package (the D176 expression
language: lexer, Pratt parser, AST, method table, printer, positioned errors),
the `conformance` package that embeds the shared tables both hosts run
(`expressions-parse.json`, `functions.json`), and the small `jsident` and
`textutil` helpers. No code generation, bundling, or CLI lives here.

## Current state


- This plan owns the language's **code binding**: the FILE cards for
  `parser/parser.go`, `parser/exprs.go`, `parser/sections.go`,
  `parser/scan.go`, `parser/slot.go`, `parser/let.go` (FILE-PARSER-LET) and
  `parser/host.go` with `options.go` (FILE-PARSER-HOST); for `expr/lexer.go`
  (with `ident.go`), `expr/parser.go` (with `errors.go`), `expr/ast.go`,
  `expr/methods.go` and `expr/print.go`; and TEST-COMPILER-PARSER for the
  module's `go test` suite. Paths are relative to this module root, so
  `stale_report` here tracks real drift.
- **Per-host switches (D172) are built** as `parser.Options`: the parser knows
  every construct, PuzzleKit passes nothing (the zero value is its grammar), and
  Sites turns on `Let` and skips the island/slot/ref checks, parsing its
  wrapper-less theme files with `ParseMarkup`. Rule: a new host feature lands
  OFF by default; PuzzleKit's no-options parse never changes.
- **`jsident` holds the shared identifier rules** (no FILE card of its own):
  `IsIDStart`/`IsIDContinue` — JavaScript's `ID_Start`/`ID_Continue` from Go's
  `unicode` tables — and `IsReservedBindingIdentifier`. `expr`'s lexer and
  `IsIdentifier`, the template lexer's tag names (`parser/lexer.go`, described
  on FILE-PARSER) and PuzzleKit's `<script>` scan all call them, so a name a
  `.pzl` spells reads the same way in every scan (DECISION-D176 rule 8,
  DECISION-D167). `textutil` has no FILE card either.
- The language's **behavioral contract** stays in the framework plan
  (`repo=puzzle`): COMPONENT-TEMPLATE-PARSER, DECISION-D176-EXPRESSION-LANGUAGE,
  the template-grammar decision cards (D172, D173, and every earlier grammar
  decision), DOC-LANGUAGE-CORE, DOC-SPEC, and DOC-TEMPLATE-SYNTAX. Plans cannot
  connect cards across repos, so the FILE and TEST cards here name those
  handles in prose.
- Versioned with the framework and tagged `packages/puzzle-lang/vX.Y.Z` next to
  the framework's `vX.Y.Z`; Cory pushes the tags. A patch may be Go-only:
  `v0.8.1` (host options for Sites) has no framework or npm release beside it.

## Conventions

- New decisions go in the framework plan's numbered DECISION cards, not here.
- `cd packages/puzzle-lang && go vet ./... && go test ./...` is this module's
  suite; the compiler's `go test ./...` does not run it.
