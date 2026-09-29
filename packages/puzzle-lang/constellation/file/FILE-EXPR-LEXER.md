---
name: expression lexer and identifier rules
status: built
path: expr/lexer.go
language: go
summary: >-
  One linear pass from expression source to tokens; decimal numbers, strict-mode string escapes,
  template-literal segments; identifier classes from the shared jsident package, reserved-word rules
  in the sibling ident.go.
connections:
  - FILE-EXPR-PARSER
  - TEST-COMPILER-PARSER
---

# expr/lexer.go (+ ident.go)

Source binding for the lexical half of DECISION-D176-EXPRESSION-LANGUAGE rule 1 (connected `puzzle` plan). `path` is relative to `packages/puzzle-lang`; the sibling `expr/ident.go` is covered here too.

- **One linear pass.** `lex` fills a caller-supplied token slice (the parser pools them) and always ends with `tEOF` or `tError`. The first lexical error ends the stream; the parser reports it only when no syntax error comes before it, so the message a user sees is the leftmost one.
- **No regular expressions.** The grammar has none, so a `/` is always a punctuator, and the parser reports a regex literal where it expected a value.
- **Numbers are decimal only** (`1`, `1.5`, `.5`, `5.`, `1e3`, `1E-3`). Hex, octal, binary, BigInt, numeric separators, a legacy leading zero, an exponent without digits and a name straight after a number are positioned errors whose messages live in `errors.go`.
- **Strings** carry JavaScript's strict-mode escapes (`\xHH`, `\uHHHH`, `\u{…}`, line continuations); a raw line break or a legacy octal escape is an error. Template literals lex as head / middle / tail segments around each `${`.
- **Punctuation edge:** `?.` is one punctuator only when no digit follows, so `a?.5:1` is a conditional, as in JavaScript. White space is JavaScript's set (NBSP, BOM and every Zs space included).
- **Identifier classes come from `jsident`.** `jsident.IsIDStart`/`IsIDContinue` (`packages/puzzle-lang/jsident/ident.go`) are JavaScript's `ID_Start`/`ID_Continue` (plus `$`, `_`, ZWNJ, ZWJ) computed from Go's `unicode` tables; the lexer's name scan and `IsIdentifier` call them, and so do the template parser's tag-name lexing (D167) and PuzzleKit's `<script>` scan, so every name a `.pzl` spells is read by one rule. The PuzzleKit compiler and Sites must build with the same Go minor, and the identifier rows of `expressions-parse.json` pin the edge characters.
- **`ident.go`** holds `IsIdentifier` and `BindingNameReason`, the one rule for every name a template binds (arrow parameters, `{#for}` items and counters, `<Snippet>` parameters, Sites' `{#let}`), and the reserved-word messages (the reserved set itself is `jsident.IsReservedBindingIdentifier`).
