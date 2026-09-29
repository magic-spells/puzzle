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

Source binding for DECISION-D176-EXPRESSION-LANGUAGE rules 1, 3 and 7 in the connected `puzzle` plan; the grammar itself is stated there and in DOC-LANGUAGE-CORE, not here. `path` is relative to `packages/puzzle-lang`; the sibling `expr/errors.go` holds the `Error` type and every message.

- **`Parse(src, base, Options{…})`** returns one tree or one `*Error`. The template parser calls it once per expression position (`parser/exprs.go`). `Options.Handler` marks an `@event` value (the free name `event` is the DOM event there, and a chain rooted at it skips the method table); `Options.Bindings` lists the names enclosing `{#for}` blocks and `<Snippet>` bodies bind, which may be read but never called; `Options.CallArgument` lets an arrow function stand at the top level.
- **`event` outside a handler is an ordinary name.** In plain mode `event.title` parses as the member read `(. event title)` and `{ event }` as an object shorthand, exactly like any data field; there is no non-handler steer and no `msgEvent`. `event.preventDefault()` outside a handler is data, so the method-table error applies to it. A template that reads `event` as data and also uses it inside a handler is codegen's positioned error (`checkEventUses` in PuzzleKit), not the parser's, because only the whole template shows both uses.
- **Pratt parsing.** Operators of one precedence loop instead of recursing, so a long flat chain parses in linear time and constant stack; nesting (groups, unary operators, conditionals, literals, arrow bodies, calls) recurses and is capped at `maxDepth` (500). Token slices come from a `sync.Pool`, because a template parses thousands of short expressions.
- **Checks after the parse:** `checkBindingCalls` rejects calling a bound name; `checkAmbient` rejects `window`, `document` and `globalThis` read as a data root ("… read it in data() and pass the value"), exempting bindings, arrow parameters, callees and a handler value's own name. Every other name, `location` and `localStorage` included, is an ordinary data read.
- **Inline checks:** a method call's name must be in the table (`methods.go`), and against the receiver's type when the syntax fixes it; `??` mixed with `&&`/`||` without parentheses is an error naming both fixes; a `|` anywhere is the steer "`| name` pipes were removed — write `name(value)`; bitwise OR is not available", naming the JavaScript replacement when the name after the pipe is a removed formatter; the other excluded operators and keywords each have their own message.
- **Messages are contract.** `errors.go` states them in the house form "… is not available in template expressions — <what to write instead>"; `expressions-parse.json` pins them word for word with their positions, so both hosts show the same text at the same column.
- **Fuzzed.** `FuzzParse` (`expr/fuzz_test.go`) seeds from every `expressions-parse.json` row in three modes — plain, handler, and bindings (`item`, `i` and a bound `event`) — and requires a tree or an `*expr.Error`, never a panic or neither; an error offset and every node position inside the source; and the same printed result from a second parse. `go test` runs the seeds only; the fuzzer runs by hand (`go test -run '^$' -fuzz=FuzzParse -fuzztime=60s ./expr`), not in CI.
