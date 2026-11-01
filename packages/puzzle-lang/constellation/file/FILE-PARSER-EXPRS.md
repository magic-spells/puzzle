---
name: template parser's expression bridge
status: verified
path: parser/exprs.go
language: go
summary: >-
  Connects the template grammar to package expr: every expression position parses as one expr.Parse
  at its own file position, with the enclosing {#for}/<Snippet> bindings in scope.
connections:
  - FILE-PARSER
  - FILE-EXPR-PARSER
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# parser/exprs.go

The seam between the template parser and `expr` (DECISION-D173-CORE-SEMANTICS
V1: every expression position parses as exactly one D176 expression; framework
plan, `repo=puzzle`). The template parser owns each position's structure —
header shapes, the `{#for}` forms, `{:when}` lists — and `expr` owns everything
inside one expression.

- **`parseExprAt`** parses one expression whose first byte sits at a file
  position and converts an `*expr.Error` into a `ParseError` at the offending
  token, wherever the expression sits (headers the lexer trimmed, bodies after odd
  white space, lines below the construct's opener). Each AST field holding source
  text (`Expr`, `Cond`, `Collection`, range bounds, `{:when}` values) gets its
  parsed sibling (`ExprAST`, `CondAST`, …) at parse time.
- **`posCursor`** maps header byte offsets to file positions in increasing order,
  so a long `{:when}` list or `{#let}` block stays linear.
- **`exprScope`** is what a position sees: the names enclosing `{#for}`,
  `<Snippet>` and `{#let}` bind (`bind`/`unbind`), the `Pipes` switch from
  `parser.Options`, and `maxDepth`, which caps inline-`{#if}` nesting inside an
  attribute value (`attr.go`) for `ParseMarkup`'s depth guard — 0, no cap, on every
  PuzzleKit path. `valueOpts` passes the bindings and pipes as `expr.Options`;
  `handlerOpts` also sets `Handler`, so `event` is the DOM event only in an
  `@event` value. Past `manyBindings` (32) names, `opts` adds an `IsBinding`
  closure over `parser.first` (each name's lowest stack index) so `expr` does not
  scan the slice per lookup; a name is in a snapshot scope when its first index is
  below the snapshot's length, which holds because scopes nest.
