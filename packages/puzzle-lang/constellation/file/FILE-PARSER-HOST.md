---
name: host options and wrapper-less parsing surface
status: verified
path: parser/host.go
language: go
summary: >-
  Public surface for a host with its own file layout: ParseMarkup (wrapper-less fragment at a file
  position, with a depth guard) plus the exported section/lexer scanners a host splitter needs.
  options.go holds parser.Options (Let, Pipes, SkipIslandCheck, SkipSlotCheck, SkipRefCheck,
  MaxDepth) whose zero value is PuzzleKit's grammar.
connections:
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
  - FILE-PARSER-SLOT
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# host.go (and options.go)

How a host other than PuzzleKit — Magic Spells Sites — uses the parser without
vendoring it (D172: one parser, per-host switches).

- **`Options`** (`options.go`): `Let` turns on `{#let}` ([[FILE-PARSER-LET]]);
  `Pipes` turns on the Sites `|` pipe in every expression position (it rides
  `exprScope` into `expr.Options.Pipes`; `x | f(a)` parses to the call
  `f(x, a)`); `SkipIslandCheck`/`SkipSlotCheck`/`SkipRefCheck` turn off the
  post-parse `validateIslands`/`validateSlots`/`validateRefs` passes; `MaxDepth`
  bounds `ParseMarkup` nesting. Every entry point (`Parse`, `ParseTemplate`,
  `ParseSkeleton`, `ParseFile`, `ParseMarkup`) takes it as an optional trailing
  variadic, and the zero value is PuzzleKit's grammar.
- **Rule:** a new host feature lands OFF by default, and a check a host may not
  want gets a `Skip…` switch. Nothing may change what a no-options parse returns:
  `TestOptionsDefaultIsPuzzleKit` parses the whole corpus with no options and with
  `Let` and `Pipes` on and requires identical results.
- **`ParseMarkup(markup, at, file, opts)`** parses content with no
  `<puzzle-view>` wrapper at file position `at` (zero = 1:1) and returns a
  synthetic container `Element` with an empty `Tag`. The host blanks its lifted
  top-level blocks to spaces (newlines kept) so offsets stay the author's.
- **Depth guard.** Sites parses untrusted theme files, and a million nested
  elements is a stack overflow `recover()` cannot catch. `ParseMarkup` first runs
  `scanNesting` (a counting token scan, no recursion) and rejects nesting past
  `MaxDepth` with "template nesting exceeds the limit of N levels" at the first
  node too deep. 0 means `DefaultMaxDepth` (200, which the playground's limit
  references); a negative value turns the guard off. Inline `{#if}` inside an
  attribute value is invisible to the token scan, so `exprScope.maxDepth` enforces
  the same limit there. The wrapped PuzzleKit entry points keep no limit.
- **Scanners for the host's splitter**, thin exports of what `SplitSections` and
  the lexer use: `TagNameAt`, `ScanOpenTag`, `FindScriptClose`, `FindStyleClose`,
  `FindTemplateClose`, `ScanBraceGroup`, `SkipBraceGroup` (`{##…}`,
  `{#comment}…{/comment}` and `{#raw}…{/raw}` whole, else a balanced group),
  `AttrNames` (names only — values never get expression semantics),
  `ParseAttrString`, `ParseScriptLang`, `ParseStyleScoped`. Conventions: every
  index in or out is absolute; an out-of-range index returns -1 or an error, never
  a panic; errors are positioned `*ParseError`s returned as `error`, nil on
  success (no typed-nil leak). A host must return `SkipBraceGroup`'s error or
  stop — stepping one byte and retrying is quadratic on a file of unclosed braces.

`parser/host_test.go` (package `parser_test`) is a full wrapper-less splitter
built from the exports alone, running the Sites splitter's own tests;
`FuzzHostScanners` fuzzes every export plus `ParseMarkup` and that splitter.
