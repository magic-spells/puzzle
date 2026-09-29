---
name: pzl section splitter
status: verified
path: parser/sections.go
language: go
summary: Top-level section discovery with close-aware scanning and positioned offsets.
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: verified
    text: >-
      0.8.0 release-prep sweep. Each bound file was diffed against the b1a8642a baseline. scan.go is
      byte-identical, since only the path moved into puzzle-lang. sections.go changed only its
      textutil import path and one comment. parser.go gained the D173 V1 chain rule (parseChain,
      isFormatterName, the {#for}/{:when} pipe bans) and the D167 name check. slot.go gained D166
      snippet markers and the D173 V13 per-path pass. The bodies now say so. The test count is 12
      files. `go vet` and `go test ./...` pass in packages/puzzle-lang.
    sha: a602784a9822fa3ff63123e597f72624b3c9ffff
---

Source binding for the template parser. Behavioral intent stays on the owning component card, COMPONENT-TEMPLATE-PARSER in the connected `puzzle` plan (`repo=puzzle`); this card anchors that contract to `packages/puzzle-lang/parser/sections.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle-lang`).

`Sections.Source` is the whole `.pzl` file `SplitSections` was given, byte for byte; every `Position.Offset` indexes it, so a caller can map a node back to its text. Codegen uses it to place the D176 `this` error on its own token, including inside the `<puzzle-view>` root attributes, which sit before `TemplatePos` (418ac888, PR #163).

`findTemplateClose` finds a section's close tag by skipping everything that cannot end the section: HTML comments, the `\{`/`\}` escapes, the D70 comments (`scanInlineComment`, `scanBlockComment`), brace groups (`scanBraceGroup`, so strings, JS comments and regexes inside an interpolation stay opaque), and a D150 `{#raw}` span. The raw case sits before the generic `{` case and uses the lexer's own `isBlockRawOpen` and `scanBlockRaw` (scan.go), so the splitter and the lexer agree on where a raw block ends: the span runs to its first whitespace-tolerant closer, or to the end of input when there is none, and nothing inside it is read. Braces, quotes, backticks, `//`, `\{`, `{##`, `{#comment}` and `<!--` in the span are inert, and so is a literal close tag, which therefore does not end the section. The first close tag seen inside a skipped span is kept in `inRaw` and returned only when the loop reaches the end of input without finding a close tag after the span, so a `{#raw}` missing its `{/raw}` (no closer at all, or the next one sitting in a later section) still splits at the real close tag, and the lexer then reports "unterminated {#raw}" at the opener instead of the splitter reporting "missing </puzzle-view>". The eslint and prettier `split.js` ports mirror this case (PR #173). A brace group that fails to scan advances the loop one byte and rescans, which is quadratic on thousands of unbalanced `{` outside a raw block; COMPONENT-TEMPLATE-PARSER's gotcha note records it as accepted, because such a file is already a compile error.
