---
name: template expression scanner
status: verified
path: parser/scan.go
language: go
summary: Shared balanced JS-like scanner and top-level splitting helpers.
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
connections:
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - TEST-COMPILER-PARSER
---

# scan.go (+ lexskip.go)

Balanced scanning and top-level splitting for the template parser. Behavioral
intent: COMPONENT-TEMPLATE-PARSER (`repo=puzzle`).

Every balanced scan routes through the one `LexSkip` helper (`lexskip.go`):
`scanBraceGroup` (where a `{ … }` group ends, skipping strings, regex-shaped
text and comments, tracking nested braces), the inline/block comment and
`{#raw}` scanners, and the top-level splitters (`splitTopLevel`,
`lastTopLevelIndexByte`, `topLevelIndex`) the `{#for}` header and `{:when}` lists
use to find their structural commas and keywords. Nothing here reads inside an
expression: once a position's text is cut out, `expr.Parse` owns it.

**Regex-versus-division rules (`lexskip.go`).** `LexSkip` also serves real
JavaScript — the `<script>` body reader (`findScriptClose`), template-literal
`${…}` scans, and the compiler's `tokenizeJS` — where a regex holding a quote,
backtick or close tag must stay opaque, so a `/` opens a regex when the previous
token cannot end an expression. The template grammar has no regex literals, so
the rules never misread a division:

- `LexPlainEndsExpr` is true for a digit, `.`, `)`, `]`, `}` and any byte ≥ 0x80;
  whitespace keeps the previous state; any other operator/delimiter means a
  following `/` opens a regex.
- An identifier run directly after a byte ≥ 0x80 is the tail of one name and
  ends an expression whatever it spells (`価格new / 2` is division); the check
  sits beside `lexPrecededByDot`, before the keyword lookup.
- `lexRegexPrecedingKeywords` is `return typeof instanceof in void delete new do
  else yield await case` — `of` is deliberately absent (a field named `of` is data).

So `{ café / 2 }`, `{ 5. / 2 }` and `{ of / 2 }` close at their brace, and a
regex-shaped template expression fails with the grammar's own error. Accepted
gotcha: in a `<script>`, a regex right after a `...` spread or `for (x of` reads
as division — it matters only when that regex holds a quote, backtick or close
tag. **The eslint `split.js` and prettier `lex.js` ports must mirror all three
rules exactly** (in JS, `s.charCodeAt(k) >= 0x80`). Tests: `lexskip_test.go`.

The `{#raw}` helpers — `isBlockRawOpen` (a `{#` whose first word is exactly
`raw`), `matchRawCloser`, `scanBlockRaw` (the opener runs to its first `}`, then
the first `{/raw}`, `{/ raw }` or `{/raw }` ends the block) — are shared by the
lexer, the section splitter's `findTemplateClose`, and the attribute scanner
(`attr.go`, which rejects a raw opener inside an attribute value). Sharing them
keeps the splitter and lexer agreed on where a raw block ends; the eslint and
prettier `split.js` ports carry JS copies of all three.
