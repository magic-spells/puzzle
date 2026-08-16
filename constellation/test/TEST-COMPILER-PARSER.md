---
name: Template parser and section splitting
kind: unit
status: built
framework: go test
connections:
  - COMPONENT-TEMPLATE-PARSER
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
  - FILE-COMPILER-INTERNAL-PARSER-SLOT
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D36-UNLESS
  - DECISION-D37-CASE-WHEN
  - DECISION-D40-ELSE-IF
  - DECISION-D46-INLINE-SVG
  - DECISION-D70-TEMPLATE-COMMENTS
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D144-PORTAL
  - DECISION-D150-RAW-TEMPLATE-BLOCK
  - DOC-TEMPLATE-SYNTAX
  - DOC-COMPILER-DESIGN
  - DOC-TESTING
---


# Template parser and section splitting

Table-driven Go tests over the compiler front end: `.pzl` section splitting,
lexing, the template grammar, and the AST.

What they guarantee:

- section scanning finds template, script, and style boundaries without ever
  parsing the script body — script bytes stay untouched JavaScript or
  TypeScript.
- the lexer skips correctly inside strings, comments, and raw regions, so
  template-looking bytes inside script or raw blocks are not treated as grammar.
- every shipped construct parses: conditionals and their else-if chains, unless,
  case/when, loops, interpolation, template comments, inline SVG, element refs,
  the raw block, composition markers, and Portal.
- rejections are positioned and actionable. A lowercase composition marker is a
  compile error steering to the capitalized form, not a silent no-op — that
  steering error is asserted, not just the rejection.

Error positions and message text are treated as contract here; loosening one
fails a test on purpose.

Covers 8 `*_test.go` files under `compiler/internal/parser`.
