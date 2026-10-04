---
name: host options and wrapper-less parsing surface
status: built
path: parser/host.go
language: go
summary: >-
  Public surface for a host with its own file layout: ParseMarkup (wrapper-less fragment at a file
  position) plus the exported section/lexer scanners a host splitter needs. options.go holds
  parser.Options (Let, SkipIslandCheck, SkipSlotCheck, SkipRefCheck) whose zero value is PuzzleKit's
  grammar.
connections:
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
  - FILE-PARSER-SLOT
  - TEST-COMPILER-PARSER
notes:
  - kind: decision
    text: >-
      Review fixes before the v0.8.1 tag froze the API:


      **Depth guard.** `ParseMarkup` runs `scanNesting`, a counting token scan with no recursion,
      before it parses. It rejects nesting past `Options.MaxDepth` with "template nesting exceeds
      the limit of N levels" at the first node too deep:

      - 0 means `DefaultMaxDepth` (200, which pzl-wasm's `maxNestingDepth` now references), and a
      negative value turns the guard off.

      - Inline `{#if}` nesting inside an attribute value is invisible to the token scan, so
      `attrCursor` enforces the same limit through `exprScope.maxDepth`. That limit is 0 on every
      PuzzleKit path.

      - Reason: a million nested `<div>`s is a stack overflow that recover() cannot catch, and Sites
      parses untrusted theme files.


      **Scanner conventions.**

      - Every index in or out is ABSOLUTE; `Find*Close` used to return offsets relative to `from`.

      - An out-of-range index returns -1 or an error, never a panic.

      - `ScanBraceGroup` and `SkipBraceGroup` now take a filename and return a positioned
      `*ParseError`.

      - `SkipBraceGroup`'s doc says a host must return that error or stop. Stepping one byte and
      retrying is quadratic on a file of unclosed braces.


      **Fuzzing.** `FuzzHostScanners` covers all of the above. 15M executions ran clean.
---

# host.go (and options.go)

How a host other than PuzzleKit uses the parser without vendoring it (D172:
one parser, per-host switches). Added in the Go-only `packages/puzzle-lang/v0.8.1`.

- **`Options`** (`options.go`): `Let` turns on `{#let}` ([[FILE-PARSER-LET]]);
  `SkipIslandCheck`/`SkipSlotCheck`/`SkipRefCheck` turn off the post-parse
  `validateIslands`/`validateSlots`/`validateRefs` passes. Every entry point
  (`Parse`, `ParseTemplate`, `ParseSkeleton`, `ParseFile`, `ParseMarkup`) takes
  it as an optional trailing variadic, so PuzzleKit's call sites are unchanged
  and the zero value is its grammar. Rule: a new host feature is added OFF by
  default; a check a host may not want gets a `Skip…` switch. Nothing may
  change what a no-options parse returns (`TestOptionsDefaultIsPuzzleKit`
  compares the whole corpus with and without Let).
- **`ParseMarkup(markup, at, file, opts)`** parses content with no
  `<puzzle-view>` wrapper at file position `at` (zero = 1:1) and returns a
  synthetic container `Element` with an empty `Tag`. The host blanks its lifted
  top-level blocks to spaces (newlines kept) so offsets stay the author's.
- **Scanners for the host's splitter**, thin exports of what `SplitSections` and
  the lexer use: `TagNameAt` (lexer tag-name rules + boundary), `ScanOpenTag`,
  `FindScriptClose`, `FindStyleClose`, `FindTemplateClose`, `ScanBraceGroup`,
  `SkipBraceGroup` (`{##…}`, `{#comment}…{/comment}` and `{#raw}…{/raw}` whole,
  else a balanced group), `AttrNames` (lexes names only — values never get
  expression semantics), `ParseAttrString`, `ParseScriptLang`,
  `ParseStyleScoped`. Exported wrappers return `error`, nil on success (no typed
  nil `*ParseError` leaks).

Sites' mapping from its vendored internals: `newLexer`+`newParser`+
`parseChildren`+`hasRaw` → `ParseMarkup`; `sites_let.go` and the syncparser
`parseBlock` patch → `Options.Let`; `scanOpenTag`, `findScriptClose`,
`findStyleClose`, `findTemplateClose`, `parseAttrString`, `parseScriptsLang`,
`parseStylesScoped` → their exports; `sitesSkipBraces` (`scanInlineComment`,
`isBlockCommentOpen`, `scanBlockComment`, `scanBraceGroup`, raw skipping) →
`SkipBraceGroup`; `isNameChar`/`isNameStart`/`isBoundary` → `TagNameAt`;
`newAttrLexer`+`Next`+`tokPos` → `AttrNames`; `posAt`/`posErr`/`errAt` →
`Position.Advance` and a `ParseError` literal. Not covered on purpose: the 0.7
pipe splitter (`parseFormatter`, `splitTopLevel` with skip-doubled) behind
Sites' 0.7→0.8 pipe migration — pipes are not in the 0.8 grammar.

`parser/host_test.go` (package `parser_test`) is a full wrapper-less splitter
built from the exports alone, running the Sites splitter's own tests.
