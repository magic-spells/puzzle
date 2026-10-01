---
name: expression AST
status: built
path: expr/ast.go
language: go
summary: >-
  The expression tree both hosts consume: Pos, the Node interface, the fourteen node types, and
  Walk.
connections:
  - FILE-EXPR-PARSER
  - FILE-EXPR-PRINT
  - TEST-COMPILER-PARSER
---

# expr/ast.go

Source binding for the tree half of DECISION-D176-EXPRESSION-LANGUAGE (rule 1) in the connected `puzzle` plan (`repo=puzzle`); the grammar's behavior stays on that card and on COMPONENT-TEMPLATE-PARSER. `path` is relative to this plan root, `packages/puzzle-lang`.

The package comment for `expr` lives here: the package holds syntax, positions and names only — no lowering, no evaluation, no knowledge of which host is asking. PuzzleKit lowers the tree to JavaScript (`packages/puzzle/compiler/internal/codegen/lower.go`); Sites will evaluate it in Go (D176 P6).

- **`Pos`** is a 1-based line and byte column plus the 0-based byte offset, all in the coordinates of the file the expression came from (the `base` passed to `Parse`), so an error reports the same line:col in both hosts.
- **Node types:** `Literal` (string, number, boolean, `null`, `undefined`; `NaN`/`Infinity` are number literals, never names), `TemplateLiteral`, `Identifier`, `Member` (dot, optional and computed), `Call`, `Arrow` with its `Param`s, `Unary`, `Binary`, `Logical`, `Conditional`, `Array`, `Object` with its `Entry`s, `Global` (a whitelisted namespace member such as `Math.round` or `Math.PI`, or a bare global function), and `Chain`, which marks the extent an optional `?.` short-circuits.
- **`Walk`** visits a tree in source order; codegen's row facts and handler verdicts, and the corpus proof, walk trees with it.
