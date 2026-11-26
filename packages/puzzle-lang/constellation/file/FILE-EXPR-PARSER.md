---
name: expression parser
status: verified
path: expr/parser.go
language: go
summary: >-
  expr.Parse: the Pratt parser over the token slice, with Options for handler values, bindings and
  Sites pipes, the method-table and ambient-global checks, and the positioned errors in errors.go.
connections:
  - FILE-EXPR-LEXER
  - FILE-EXPR-AST
  - FILE-EXPR-METHODS
  - FILE-PARSER-EXPRS
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# expr/parser.go (+ errors.go)

The D176 expression parser (DECISION-D176-EXPRESSION-LANGUAGE rules 1, 3, 7 and
DOC-LANGUAGE-CORE in the framework plan state the grammar). `errors.go` holds the
`Error` type and every message.

- **`Parse(src, base, Options{…})`** returns one tree or one `*Error`; the template
  parser calls it once per position ([[FILE-PARSER-EXPRS]]). The zero `Options` is
  PuzzleKit's grammar:
  - `Handler` marks an `@event` value: the free name `event` is the DOM event
    there, and a chain rooted at it skips the method table.
  - `Bindings` lists the names enclosing `{#for}`/`<Snippet>` (and Sites'
    `{#let}`) bind — readable, never callable. `IsBinding` is an optional O(1)
    membership test that replaces the scan and must agree with `Bindings`; the
    template parser passes it only past 32 names (a long `{#let}` block).
  - `Pipes` turns on the Sites `|` pipe.
- **Arrows only as call arguments** (`parseArgument`): `items.filter(i => i.done)`.
  Anywhere else is the "arrow functions are only available as a call argument"
  error.
- **Pipes (`parsePipes`).** `parseBinary` stops at a `|` when `Pipes` is on, and
  `parseExpr` loops over `| name` / `| name(args)` links before the `?` check, so a
  pipe binds looser than every binary and logical operator and tighter than `?:`
  (`a ? b | f : c` is `a ? f(b) : c`). Each link builds exactly the `*Call` its
  written form `name(x, args…)` produces — there is no pipe node; the Call starts at
  the piped value. The name may be any identifier except a literal word (`true`,
  `null`, `NaN`, …) or an operator keyword; statement words such as `default` are
  allowed (`x | default(0)`). A namespace (`Math`) or a dotted name is refused with
  "expected a function name after `|`" (Code `CodePipe`). A bare global function
  (`| Number`) becomes its `Global` callee. An arrow parameter or a template
  binding fails as a written call would.
- **Pipes off** (PuzzleKit), a `|` is the `CodePipe` steer: "`| name` pipes are
  Sites theme syntax — in a Puzzle app write `name(value)`"; "; bitwise OR is not
  available" is appended when no name follows, and a removed formatter's name gets
  its replacement named instead.
- **`event` outside a handler is an ordinary data name** (`event.title` is a
  member read, `event.preventDefault()` hits the method-table error). A template
  that reads `event` as data and also uses it in a handler is codegen's error
  (`checkEventUses`), since only the whole template shows both uses.
- **Pratt parsing.** One precedence level loops instead of recursing, so a long
  flat chain is linear time and constant stack; nesting recurses, capped at
  `maxDepth` (500). Token slices come from a `sync.Pool`.
- **After the parse:** `checkBindingCalls` rejects calling a bound name;
  `checkAmbient` rejects `window`, `document` and `globalThis` as a data root
  ("… read it in data() and pass the value"), exempting bindings, arrow
  parameters, callees and a handler value's own name. Every other name
  (`location`, `localStorage` included) is an ordinary data read.
- **Inline checks:** a method name must be in the table ([[FILE-EXPR-METHODS]])
  and match the receiver's type when syntax fixes it; `??` mixed with `&&`/`||`
  without parentheses names both fixes; every other excluded operator and keyword
  has its own message.
- **Messages are contract.** House form: "… is not available in template
  expressions — <what to write instead>". `conformance/expressions-parse.json`
  pins them word for word with positions, so both hosts show the same text at the
  same column.
- **Fuzzed.** `FuzzParse` (`expr/fuzz_test.go`) seeds from every
  `expressions-parse.json` row in plain, handler, bindings and pipes modes plus
  pipe-chain seeds, and requires a tree or an `*expr.Error` (never a panic or
  neither), in-source positions, and a stable reprint. `go test` runs the seeds
  only; fuzz by hand: `go test -run '^$' -fuzz=FuzzParse -fuzztime=60s ./expr`.
