---
name: expression parser
status: built
path: expr/parser.go
language: go
summary: >-
  expr.Parse: the Pratt parser over the token slice, with Options for handler, bindings and
  call-argument positions, the method-table and ambient-global checks, and the positioned errors in
  errors.go.
connections:
  - FILE-EXPR-LEXER
  - FILE-EXPR-AST
  - FILE-EXPR-METHODS
  - FILE-PARSER-EXPRS
  - TEST-COMPILER-PARSER
---

# expr/parser.go (+ errors.go)

The D176 expression parser (DECISION-D176-EXPRESSION-LANGUAGE rules 1, 3, 7 and
DOC-LANGUAGE-CORE in the framework plan state the grammar). `errors.go` holds the
`Error` type and every message.

- **`Parse(src, base, Options{…})`** returns one tree or one `*Error`; the template
  parser calls it once per position ([[FILE-PARSER-EXPRS]]). `Options.Handler`
  marks an `@event` value (the free name `event` is the DOM event there, and a
  chain rooted at it skips the method table); `Options.Bindings` lists names
  enclosing `{#for}`/`<Snippet>` bind, readable but never callable;
  `Options.CallArgument` lets an arrow stand at the top level.
- **`event` outside a handler is an ordinary data name** (`event.title` is a
  member read, `{ event }` an object shorthand, `event.preventDefault()` hits the
  method-table error). A template that reads `event` as data and also uses it in a
  handler is codegen's positioned error (`checkEventUses`), since only the whole
  template shows both uses.
- **Pratt parsing.** One precedence level loops instead of recursing, so a long
  flat chain is linear time and constant stack; nesting (groups, unary,
  conditionals, literals, arrow bodies, calls) recurses, capped at `maxDepth`
  (500). Token slices come from a `sync.Pool` — a template parses thousands of
  short expressions.
- **After the parse:** `checkBindingCalls` rejects calling a bound name;
  `checkAmbient` rejects `window`, `document` and `globalThis` as a data root
  ("… read it in data() and pass the value"), exempting bindings, arrow
  parameters, callees and a handler value's own name. Every other name
  (`location`, `localStorage` included) is an ordinary data read.
- **Inline checks:** a method name must be in the table ([[FILE-EXPR-METHODS]]),
  and match the receiver's type when syntax fixes it; `??` mixed with `&&`/`||`
  without parentheses names both fixes; a `|` is rejected with "`| name` pipes
  were removed — write `name(value)`; bitwise OR is not available" (naming the JS
  replacement when the name is a removed function); other excluded operators and
  keywords each have their own message.
- **Messages are contract.** House form: "… is not available in template
  expressions — <what to write instead>". `conformance/expressions-parse.json`
  pins them word for word with positions, so both hosts show the same text at the
  same column.
- **Fuzzed.** `FuzzParse` (`expr/fuzz_test.go`) seeds from every
  `expressions-parse.json` row in plain, handler and bindings modes and requires a
  tree or an `*expr.Error` (never a panic or neither), in-source positions, and a
  stable reprint. `go test` runs the seeds only; fuzz by hand:
  `go test -run '^$' -fuzz=FuzzParse -fuzztime=60s ./expr`.
