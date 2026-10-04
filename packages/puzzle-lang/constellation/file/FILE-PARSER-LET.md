---
name: '{#let} block (opt-in host extension)'
status: built
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
notes:
  - kind: gotcha
    text: >-
      A `{#let}` block parses in linear time, and three things keep it that way:

      - Binding positions come from one `posCursor` over the header.

      - Duplicate names are a map lookup.

      - Once the binding stack grows past `manyBindings` (32), `parser.first` indexes each name's
      lowest stack index. `exprScope.opts` then hands expr an `IsBinding` closure, so expr does not
      scan the whole slice for every call. A name is in a snapshot scope when its first index is
      below the snapshot's length, which is valid because scopes nest.


      Before this, a 430 KB block took 5.6 s. `TestLargeLetBlockParsesWithinBudget` now allows 100
      ms, or 300 ms in CI.


      `depth.go` counts `{#let}` as void, like `{#svg}`.
---

# let.go

The `{#let}` block, a dialect extension (D172) that only parses when
`Options.Let` is on. Sites turns it on; PuzzleKit never does (D176: a computed
value is a `data()` field), so a PuzzleKit tree never holds a `Let` node. Ported
from Sites' vendored `sites_let.go` (0.7) minus everything about formatter pipes.

- **Void block.** `parseBlock`'s `case "let"` returns the node directly, like
  `{#svg}`; there is no `{/let}` (`let` is not a known closer keyword, so a stray
  `{/let}` lexes as an interpolation and fails as an expression at that brace).
  Single-line `{#let a = 1}` or one assignment per line; lines split with
  `splitTopLevel(rest, '\n')`, so a newline inside brackets or a string stays in
  its binding.
- **Scope.** `parseLet` calls `p.bind(name)` after each binding's value parses:
  sequential (each sees the ones above it, never itself, so `{#let t = t}` reads
  the outer `t`), and the name lasts until the enclosing child list ends —
  `parseChildren` defers `p.unbind(len(p.bound))` at entry. An element's
  children, each `{#if}`/`{:else if}`/`{:else}` branch, each `{:when}` clause and
  a `{#for}` body are separate lists. A later block may re-bind a name
  (shadowing); one block may not name it twice (that check moved here from Sites'
  `template/pzl/validate.go`, same message).
- **Names** follow the language's one binding rule: `expr.IsIdentifier`
  (Unicode, like `{#for}`), then `jsident.IsReservedBindingIdentifier`
  ("is reserved", Sites' wording), then `expr.BindingNameReason` (literal words,
  meaningful globals). Deviation from the vendored 0.7 port: Sites accepted only
  ASCII names and allowed `Math`/`NaN`.
- **Value.** One `expr.Parse` at the value's own file position with the current
  scope; stored as `LetBinding.Interp` (an `Interpolation` whose `Pos` is the
  value's first byte, not a brace) so Sites' renderer keeps its shape.
- **Diagnostics** are positioned at the binding's own line (`restPos` comes from
  the lexer's `ValPos`, no source search). With Let on, the unknown-block message
  lists `{#let}`, and `assign set var const lets let_` get a did-you-mean.
  With Let off, every one of those is the exact pre-0.8.1 PuzzleKit message.
  A `{#let}` between `{#case}` and its first `{:when}` is the case-lead error.

Gotcha: the assignment `=` is the first top-level `=` not preceded by
`! < > = + - * / %` and not part of `==`; `a += 1` is therefore "missing '='".
