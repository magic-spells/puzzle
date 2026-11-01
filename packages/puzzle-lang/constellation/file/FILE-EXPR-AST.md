---
name: expression AST
status: verified
path: expr/ast.go
language: go
summary: >-
  The expression tree both hosts consume: Pos, the Node interface, the fourteen node types, and
  Walk.
connections:
  - FILE-EXPR-PARSER
  - FILE-EXPR-PRINT
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# expr/ast.go

The expression tree both hosts consume — the tree half of DECISION-D176-EXPRESSION-LANGUAGE rule 1 (framework plan, `repo=puzzle`; grammar behavior also on COMPONENT-TEMPLATE-PARSER). It also carries the `expr` package comment: the package holds syntax, positions and names only — no lowering, no evaluation, no knowledge of which host is asking. PuzzleKit lowers the tree to JavaScript (`packages/puzzle/compiler/internal/codegen/lower.go`); Sites evaluates the same tree in Go.

- **`Pos`** is a 1-based line and byte column plus the 0-based byte offset, all in the coordinates of the file the expression came from (the `base` passed to `Parse`), so an error reports the same line:col in both hosts.
- **Node types:** `Literal` (string, number, boolean, `null`, `undefined`; `NaN`/`Infinity` are number literals, never names), `TemplateLiteral`, `Identifier`, `Member` (dot, optional and computed), `Call`, `Arrow` with its `Param`s, `Unary`, `Binary`, `Logical`, `Conditional`, `Array`, `Object` with its `Entry`s, `Global` (a whitelisted namespace member such as `Math.round` or `Math.PI`, or a bare global function), and `Chain`, which marks the extent an optional `?.` short-circuits. There is no pipe node: a Sites pipe parses to the `Call` its written form produces.
- **`Walk`** visits a tree in source order; codegen's row facts and handler verdicts, and the corpus proof, use it.
