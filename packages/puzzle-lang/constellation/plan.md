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
AST, positioned `ParseError`s) and the small `jsident` and `textutil` helpers.
No code generation, bundling, or CLI lives here.

## Current state

- This plan owns the parser's **code binding**: the FILE cards for
  `parser/parser.go`, `parser/sections.go`, `parser/scan.go`, and
  `parser/slot.go`, and TEST-COMPILER-PARSER for the module's `go test` suite.
  Paths are relative to this module root, so `stale_report` here tracks real
  parser drift.
- The parser's **behavioral contract** stays in the framework plan
  (`repo=puzzle`): COMPONENT-TEMPLATE-PARSER, the template-grammar decision
  cards (D172, D173, and every earlier grammar decision), DOC-SPEC, and
  DOC-TEMPLATE-SYNTAX. Plans cannot connect cards across repos, so the FILE and
  TEST cards here name those handles in prose.
- Versioned in lockstep with the framework and tagged
  `packages/puzzle-lang/vX.Y.Z` next to the framework's `vX.Y.Z`; Cory pushes
  both tags.

## Conventions

- New decisions go in the framework plan's numbered DECISION cards, not here.
- `cd packages/puzzle-lang && go vet ./... && go test ./...` is this module's
  suite; the compiler's `go test ./...` does not run it.
