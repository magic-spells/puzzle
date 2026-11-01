---
name: '{#let} block (opt-in host extension)'
status: verified
path: parser/let.go
language: go
summary: >-
  The {#let} void block behind Options.Let: single-line and multiline forms, sequential bindings
  scoped to the enclosing child list with shadowing, one expression per right-hand side, names bound
  as expr Bindings, positioned diagnostics with typo hints; off, the unchanged unknown-block error.
connections:
  - FILE-PARSER
  - FILE-PARSER-HOST
  - FILE-PARSER-EXPRS
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# let.go

The `{#let}` block, a dialect extension (D172) that parses only when
`Options.Let` is on. Sites turns it on; PuzzleKit never does (D176: a computed
value is a `data()` field), so a PuzzleKit tree never holds a `Let` node.

- **Void block.** `parseBlock`'s `case "let"` returns the node directly, like
  `{#svg}`; there is no `{/let}` (a stray `{/let}` lexes as an interpolation and
  fails as an expression at that brace). `depth.go` counts it as void too.
  Single-line `{#let a = 1}` or one assignment per line; lines split with
  `splitTopLevel(rest, '\n')`, so a newline inside brackets or a string stays in
  its binding.
- **Scope.** `parseLet` calls `p.bind(name)` after each binding's value parses:
  sequential (each sees the ones above it, never itself, so `{#let t = t}` reads
  the outer `t`), and the name lasts until the enclosing child list ends —
  `parseChildren` defers `p.unbind(len(p.bound))` at entry. An element's
  children, each `{#if}`/`{:else if}`/`{:else}` branch, each `{:when}` clause and
  a `{#for}` body are separate lists. A later block may re-bind a name
  (shadowing); one block may not name it twice.
- **Names** follow the language's one binding rule: `expr.IsIdentifier`
  (Unicode, like `{#for}`), then `jsident.IsReservedBindingIdentifier`
  ("is reserved"), then `expr.BindingNameReason` (literal words, meaningful
  globals such as `Math` and `NaN`).
- **Value.** One `expr.Parse` at the value's own file position with the current
  scope, stored as `LetBinding.Interp` (an `Interpolation` whose `Pos` is the
  value's first byte, not a brace), the shape Sites' renderer reads.
- **Diagnostics** are positioned at the binding's own line (`restPos` comes from
  the lexer's `ValPos`, no source search). With Let on, the unknown-block message
  lists `{#let}`, and `assign set var const lets let_` get a did-you-mean; with
  Let off, those are PuzzleKit's plain unknown-block errors. A `{#let}` between
  `{#case}` and its first `{:when}` is the case-lead error.
- **Linear time.** Binding positions come from one `posCursor` over the header,
  duplicate names are a map lookup, and past 32 bindings `expr` gets an
  `IsBinding` closure instead of scanning the stack ([[FILE-PARSER-EXPRS]]).
  `TestLargeLetBlockParsesWithinBudget` guards it.

**Gotcha:** the assignment `=` is the first top-level `=` not preceded by
`! < > = + - * / %` and not part of `==`; `a += 1` is therefore "missing '='".
