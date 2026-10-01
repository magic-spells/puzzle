---
name: expression printer
status: built
path: expr/print.go
language: go
summary: >-
  Print renders a tree as the compact S-expression the conformance fixtures use; PrintPositions
  lists node positions; FormatNumber prints a number as JavaScript's Number.prototype.toString does.
connections:
  - FILE-EXPR-AST
  - TEST-COMPILER-PARSER
---

# expr/print.go

Source binding for the conformance side of DECISION-D176-EXPRESSION-LANGUAGE rule 8 ("shared conformance") in the connected `puzzle` plan. `path` is relative to `packages/puzzle-lang`.

- **`Print`** renders a tree as the S-expression `conformance/expressions-parse.json` stores in each row's `ast`: `(. a b)`, `(?. a b)`, `(call callee arg…)`, `(global Math.round)`, `(=> (x i) body)`, `(object (k v) ('a b' v) (s))`, `(chain …)`, and so on (the file's header lists every form). Positions are not printed; **`PrintPositions`** lists them for the `positions` column. Sites runs the same rows through the same printer, so a tree is identical in both hosts or a row fails.
- **Strings** print single-quoted with `\\ \' \n \r \t` escaped and any other control or line-separator character as `\u{…}`.
- **`FormatNumber`** prints a float64 exactly as JavaScript's `Number.prototype.toString` does (shortest round-trip digits, exponent form at or above 1e21 and below 1e-6, `-0` as `0`) — the rule D173 V6 value printing and the Sites evaluator both need. `TestFormatNumber` pins it.
