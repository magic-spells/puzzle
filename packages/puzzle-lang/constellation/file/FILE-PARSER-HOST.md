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
