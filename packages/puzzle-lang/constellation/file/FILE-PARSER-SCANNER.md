---
name: template expression scanner
status: verified
path: parser/scan.go
language: go
summary: Shared balanced JS-like scanner and top-level splitting helpers.
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

Source binding for the template parser. Behavioral intent stays on the owning component card, COMPONENT-TEMPLATE-PARSER in the connected `puzzle` plan (`repo=puzzle`); this card anchors that contract to `packages/puzzle-lang/parser/scan.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle-lang`).

Every balanced scan here routes through the one `LexSkip` helper (`lexskip.go`): `scanBraceGroup` (the one scan that finds where a `{ … }` group ends, skipping strings, regex-shaped text and comments and tracking nested braces), the inline/block comment and `{#raw}` scanners, and the top-level splitters (`splitTopLevel`, `lastTopLevelIndexByte`, `topLevelIndex`) that the `{#for}` header and `{:when}` value lists use to find their structural commas and keywords. Nothing here reads inside an expression: once a position's text is cut out, `expr.Parse` owns it, so the scanner has no pipe or formatter-argument logic.

**The regex-versus-division rules (`lexskip.go`).** `LexSkip` also serves real JavaScript — the `<script>` body reader (`findScriptClose`, sections.go), `lexScanTemplateLiteral`'s `${…}` scan, and the compiler's `tokenizeJS` — where a regex literal holding a quote, a backtick or a close tag must stay opaque, so it still takes a `/` for a regex opener when the previous token cannot end an expression. The template grammar has no regex literals, so the rules are written never to misread a division an expression can hold:

- `LexPlainEndsExpr` returns true for a digit, a `.`, `)`, `]`, `}` and any byte ≥ 0x80 (outside a string a non-ASCII byte belongs to a name, and a `.` ends a number such as `5.` or leads a property name); whitespace keeps the previous state; every other operator or delimiter means a following `/` opens a regex.
- An identifier run directly after a byte ≥ 0x80 (no whitespace skipped) is the tail of one name, so it ends an expression whatever it spells — `価格new / 2` is division. The check sits beside `lexPrecededByDot`, before the keyword lookup.
- `lexRegexPrecedingKeywords` is `return typeof instanceof in void delete new do else yield await case`. `of` is deliberately absent: it is a contextual word, and a template field named `of` is data.

So `{ café / 2 }`, `{ 5. / 2 }` and `{ of / 2 }` close at their brace in every template position, and a regex-shaped template expression still closes at its brace and fails with the grammar's own error. Accepted gotcha: in a `<script>`, a regex directly after a `...` spread or `for (x of` reads as division, which matters only when that regex holds a quote, a backtick or a close tag. The eslint `split.js` and prettier `lex.js` ports must mirror all three rules exactly (in JavaScript, `s.charCodeAt(k) >= 0x80` — every UTF-16 unit of a non-ASCII character qualifies, as every UTF-8 byte does); the string, template-literal, comment and `++`/`--` skips and the `{/`-closer rule are unchanged. Tests: `lexskip_test.go` (`TestLexPlainEndsExpr`, `TestParseDivisionInEveryTemplatePosition`, `TestParseRegexShapedExpressionIsAnExpressionError`, `TestScriptScanSkipsARegexHoldingAQuote`).

The `{#raw}` helpers — `isBlockRawOpen` (a `{#` whose first word is exactly `raw`), `matchRawCloser` and `scanBlockRaw` (the opener runs to its first `}`, then the first `{/raw}`, `{/ raw }` or `{/raw }` ends the block) — are shared by the lexer and the section splitter's `findTemplateClose` (sections.go), which skips a raw span whole; sharing them is what keeps the splitter and the lexer agreed on where a raw block ends. `isBlockRawOpen` also serves the attribute scanner (`attr.go`), which rejects a raw opener inside an attribute value. The eslint and prettier `split.js` ports carry JS copies of all three.
