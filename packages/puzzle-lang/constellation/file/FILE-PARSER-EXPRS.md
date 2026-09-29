---
name: template parser's expression bridge
status: built
path: parser/exprs.go
language: go
summary: >-
  Connects the template grammar to package expr: every expression position parses as one expr.Parse
  at its own file position, with the enclosing {#for}/<Snippet> bindings in scope.
connections:
  - FILE-PARSER
  - FILE-EXPR-PARSER
  - TEST-COMPILER-PARSER
---

# parser/exprs.go

Source binding for COMPONENT-TEMPLATE-PARSER's expression positions and DECISION-D173-CORE-SEMANTICS V1 ("every expression position parses as exactly one expression of the D176 grammar"), in the connected `puzzle` plan. `path` is relative to `packages/puzzle-lang`.

The template parser owns each position's structure — header shapes, the `{#for}` forms, `{:when}` value lists — and `expr` owns everything inside one expression. This file is the seam:

- **`parseExprAt`** parses one expression whose first byte sits at a file position and converts an `*expr.Error` into a `ParseError` at the offending token, wherever the expression sits (headers the lexer trimmed, bodies after odd white space, lines below the construct's opener). Each AST field that holds source text (`Expr`, `Cond`, `Collection`, the range bounds, `{:when}` values) gets its parsed sibling (`ExprAST`, `CondAST`, …) at parse time.
- **`posCursor`** maps byte offsets in a header to file positions in increasing order, so a long `{:when}` list stays linear.
- **`exprScope`** is what a position sees: the names enclosing `{#for}` blocks and `<Snippet>` bodies bind (`bind`/`unbind` push and pop them). `valueOpts` passes them as `expr.Options.Bindings`; `handlerOpts` also sets `Handler`, so `event` is the DOM event only in an `@event` value.

There is no formatter-chain code anywhere in the template parser: a `|` is an ordinary token that `expr.Parse` rejects with the pipe steer.
