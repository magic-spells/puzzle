---
name: pzl section splitter
status: verified
path: parser/sections.go
language: go
summary: Top-level section discovery with close-aware scanning and positioned offsets.
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
connections:
  - FILE-PARSER
  - FILE-PARSER-SCANNER
  - TEST-COMPILER-PARSER
---

# sections.go

The `.pzl` section splitter (`SplitSections`). Behavioral intent:
COMPONENT-TEMPLATE-PARSER (`repo=puzzle`).

- **`Sections.Source` is the whole file, byte for byte**; every
  `Position.Offset` indexes it, so a caller can map a node back to its text.
  Codegen relies on it to place the D176 `this` error on its own token, including
  in the `<puzzle-view>` root attributes that sit before `TemplatePos`.
- **`findTemplateClose`** finds a section's close tag by skipping everything
  that cannot end it: HTML comments, the `\{`/`\}` escapes, D70 comments, brace
  groups (`scanBraceGroup`, so strings, JS comments and regexes inside an
  interpolation stay opaque), and a D150 `{#raw}` span. The raw case sits before
  the generic `{` case and uses the lexer's own `isBlockRawOpen`/`scanBlockRaw`
  ([[FILE-PARSER-SCANNER]]), so splitter and lexer agree where a raw block ends;
  nothing inside the span is read, a literal close tag included.
- **A `{#raw}` missing its closer** still splits at the real close tag: the
  first close tag seen inside a skipped span is kept in `inRaw` and returned only
  when no close tag follows the span, so the lexer reports "unterminated {#raw}"
  at the opener instead of the splitter reporting "missing </puzzle-view>". The
  eslint and prettier `split.js` ports mirror this.
- Accepted: a brace group that fails to scan advances one byte and rescans,
  quadratic on thousands of unbalanced `{` outside a raw block — such a file is
  already a compile error.
- Also reads `<script lang>` (`""` | `"ts"`) and the `<puzzle-skeleton>`
  `min-duration` attribute, each attribute error positioned.
