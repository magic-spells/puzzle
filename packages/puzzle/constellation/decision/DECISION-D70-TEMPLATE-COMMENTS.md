---
name: 'D70 — Template comments: {## } inline + {#comment}…{/comment} raw block'
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D40-ELSE-IF
  - DECISION-D46-INLINE-SVG
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D70 — Template comments: `{## }` inline + `{#comment}…{/comment}` raw block

HTML comments `<!-- -->` are stripped at compile time but can't nest or contain `-->`, so they can't comment out template code. Two brace-native spellings vanish **at the lexer** (no tokens), which makes them legal at every text position with no parser special-casing — between `{#case}` clauses, beside `{:else}`, in `{#for}` and `<puzzle-skeleton>` bodies. Spec: [[DOC-SPEC-TEMPLATE]] §6.

## Decision

- **`{## any text }`** — inline. Terminated by a *dumb* scanner that tracks `{`/`}` depth and honors `\{`/`\}`, deliberately not string/regex-aware (an apostrophe in `{## don't }` would otherwise open a string). Balanced braces inside are fine; a lone `}` needs `\}`. Unclosed at EOF is a positioned error at the opener.
- **`{#comment} … {/comment}`** — the body is raw text scanned for the closer without lexing, so malformed or half-written markup can be commented out. Nested `{#comment}` openers are counted; the closer tolerates whitespace (`{/ comment }`); text after the opener keyword is ignored. Unterminated is a positioned error.
- **Text positions only.** In an attribute value either spelling is a positioned error: `template comments are not allowed in attribute values`.
- Raw scans count newlines, so positions after a multiline comment stay exact.

## Alternatives rejected

- **String-aware body scanning** — comments are prose; apostrophes would break files.
- **Parse-then-drop block body** — the body would have to be well-formed, defeating "comment out broken code".
- **Symmetric `{## … ##}` closer** — a second thing to remember; depth + `\}` covers the case.

## Gotchas

- Tailwind's raw-source scanner can still lift utility-shaped words out of a comment into `styles.css` (never into the JS bundle).
- The lint/format plugins' vendored lexer ports and the three editor grammars must recognize both spellings.
