---
name: pzl section splitter
status: verified
path: parser/sections.go
language: go
summary: Top-level section discovery with close-aware scanning and positioned offsets.
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
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
  that cannot end it: HTML comments, the `\{`/`\}` escapes, D70 comments, complete
  opening tags (so a literal `</puzzle-view>` inside a quoted attribute cannot end
  the section), brace groups (`scanBraceGroup`, so strings, JS comments and regexes
  inside an interpolation stay opaque), and a D150 `{#raw}` span. The raw case
  sits before the generic `{` case and uses the lexer's own
  `isBlockRawOpen`/`scanBlockRaw` ([[FILE-PARSER-SCANNER]]), so splitter and lexer
  agree where a raw block ends.
- **Opening-tag scans handle brace groups before quotes**, so a quote inside an
  attribute's `{ … }` expression cannot end the tag.
- **A `{#raw}` missing its closer** still splits at the real close tag: the
  first close tag seen inside a skipped span is kept in `inRaw` and returned only
  when no close tag follows the span, so the lexer reports "unterminated {#raw}"
  at the opener instead of the splitter reporting "missing </puzzle-view>".
- **Unclosed `<script>` diagnostic.** When `findScriptClose` finds no
  `</script>`, it also returns where the opaque unit (string, regex, template
  literal, comment) that swallowed the last `</script>` began, and the splitter
  reports "string or regex starting here runs past </script>; if it is a regex
  literal after an unbraced if/while/for, wrap the body in braces" there. Usual
  cause: `if (x) /["']/.test(x)` — after `)` the `/` reads as division, so the
  quote opens a string. The eslint/prettier ports keep a plain "missing </script>".
- Accepted: a brace group that fails to scan advances one byte and rescans,
  quadratic on thousands of unbalanced `{` outside a raw block — such a file is
  already a compile error.
- Also reads `<script lang>` (`""` | `"ts"`) and the `<puzzle-skeleton>`
  `min-duration` attribute, each attribute error positioned.

The eslint and prettier `split.js` ports mirror the raw-block, quoted-attribute
and opening-tag rules.
