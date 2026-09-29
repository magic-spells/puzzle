---
name: 'D150 — Raw template block: lex braces as literal text while preserving HTML'
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - COMPONENT-FORMATTERS
  - DOC-SPEC-TEMPLATE
  - DOC-SPEC
  - DOC-TEMPLATE-SYNTAX
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D70-TEMPLATE-COMMENTS
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
verified_at: '2026-08-24T18:51:36.546Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
code_refs:
  - client-runtime/views/viewManager.js
notes:
  - kind: verified
    text: Raw-span whitespace demotion truthed against the parser's demoteRawMarkerLayout.
    sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D150 — Raw template block: lex braces as literal text while preserving HTML

## Context

Template braces always enter Puzzle grammar, so static JSON, JavaScript, CSS,
and examples containing literal block syntax cannot be written directly in a
template. The value-level `escape()` and `raw()` functions run after the
lexer and cannot solve a lexer failure. `{#comment}` already proves that a block
body can be located without lexing it, but comments discard that body.

## Decision

`{#raw}…{/raw}` is an additive, non-nesting lex-off block. The scanner locates
the first whitespace-tolerant closer without inspecting the body. While inside
that span, braces are literal bytes: interpolation (and every expression and
function call inside one), block/branch tags, and brace-valued event bindings
do not activate Puzzle grammar. HTML tokenization remains active, so elements and their static
attributes still become ordinary vnodes, and an HTML void element (`<br>`,
`<input …>`) closes at its start tag there as it does everywhere. Opener
content after `raw` is ignored, matching `{#comment}`.

The section splitter reads the block the same way. `findTemplateClose`
(`sections.go`) recognizes the opener with the lexer's own `isBlockRawOpen` and
finds the span's end with the lexer's `scanBlockRaw`, so the splitter and the
lexer always agree on where a raw block ends, and the splitter steps over the
whole span without reading it: braces, quotes, backticks, `//`, `\{`, `{##`,
`{#comment}` and `<!--` inside it are inert. So is a literal section close
tag. A `</puzzle-view>` inside a raw body does not end the section, so
`<pre>{#raw}<puzzle-view>…</puzzle-view>{/raw}</pre>` compiles as sample
markup. One safeguard keeps an unterminated block diagnosable: the first close
tag seen inside a skipped span is kept as a fallback and returned only when no
close tag follows the span. A `{#raw}` missing its `{/raw}` (no closer at all,
or the next `{/raw}` sitting in the skeleton) therefore still splits at the
real close tag, and the lexer reports `unterminated {#raw}` at the opener
instead of the splitter reporting `missing </puzzle-view>`. The eslint and
prettier plugins' vendored splitters mirror this rule.

The parser emits raw-body text as ordinary `Text` nodes, so codegen emits string
literals and never sends it through expression resolution. Every attribute
inside the block is a static authored literal: a brace-valued attribute is
static text — though finding where its value ENDS still uses the shared
JS-lexically-aware brace scan, so a `}` inside a string, template literal,
regex, or comment does not close it (`data-json={ {"text": "}"} }` survives),
and an unbalanced quote inside such a value is a positioned compile error even
though the bytes are otherwise uninterpreted. Boundary detection is the one
thing the raw block cannot do byte-naively; only the span is taken from that
scan, never a meaning. An `@`-prefixed name uses a private vnode-key escape so ViewManager
and the SSG serializer write the authored name instead of binding a listener,
and no raw attribute reaches directive handling — a sample `ref` skips ref
validation and emission, `island` freezes nothing, and namespace checks do not
apply. The four reserved names the runtime intercepts by bare key (`ref`,
`island`, `key`, `flip`) are omitted from the emitted vnode rather than
serialized: the `@@` escape can only encode `@`-prefixed names, and rendering
them as authored would take a runtime-side attr escape in setAttr and the
serializer — client bytes for an attribute no viewer can see. Rendered output is
unchanged; the raw body is simply inert.

The marker and component grammar is inert inside the block as well: `<slot>`,
`<children>`, and capitalized tags (`<Card/>`, `<Slot/>`, `<Children/>`,
`<Portal>`) parse as plain elements, so sample markup can show composition
syntax without instantiating it or tripping the D134 steering error.

The client-only literal-`@` shim is usage-gated under D89. Any parsed raw block
in either the main template or skeleton sets the deliberately over-inclusive
`HasRawAt` scan bit and emits `__PUZZLE_HAS_RAW_AT__=true`; the ViewManager's two
`@@` branches and `setLiteralAtAttr` call use the full inline probe. A raw block
without an `@` attribute may retain a few unnecessary bytes, but a false
negative can never send `@x` through the throwing `setAttribute` path. Undefined
means enabled for unbundled consumers and Vitest.

Serialization reuses the existing parent-aware rules. Normal element text is
entity-escaped in prerendered HTML and decoded back by the HTML parser;
`script`/`style` content takes D113's RAWTEXT path. JSON-typed scripts retain
D113's JSON-transparent `<` to `\u003c` rewrite. Client rendering always creates
text nodes, so the same payload reaches `textContent` in both paths.

The block is legal only at text positions. Use inside an attribute value is a
positioned compile error. An unterminated block errors at its opener. A literal
`{/raw}` cannot occur in the body because the first closer always wins.

## Alternatives rejected

- **Emit the body as one opaque text node** — would make `<b>` display as source
  instead of remaining ordinary HTML.
- **Parse the body normally and suppress only known block tags** — misses
  interpolations and future syntax; the feature is defined by braces being
  inert, not by a growing directive denylist.
- **Entity-escape every prerendered body** — corrupts script/style RAWTEXT,
  which the HTML parser never entity-decodes.
- **Emit every body byte-raw during prerender** — turns normal-element text into
  markup and bypasses D113's script breakout protections.
- **Treat `{#raw}` as dynamic raw HTML** — there is no expression inside the
  block and no runtime value can reach it. Dynamic HTML is a value-level job:
  the `raw()` function injects a value as markup through an allowlist
  sanitizer ([[DECISION-D174-STANDARD-FORMATTERS]]), and this block stays
  static.
- **Let the section splitter scan a raw body as brace groups** — that inspects
  the body this decision says is never inspected. An unbalanced `{`, a quote or
  a `//` in raw content carries the JS-aware brace scan past `</puzzle-view>`
  into the script, where the quote parity of the script's imports and comments
  decides whether it comes back, so a file that has its close tag fails with
  "missing `</puzzle-view>`". Whether a literal close tag inside a raw body
  ends the section becomes an accident of that scan (one inside a raw
  `{ … }` never does), and every unbalanced `{` reruns a failed scan to the end
  of the file: a 40 KB raw block of `{` took 3.79 s to parse, against about
  0.3 ms when the span is skipped whole.

## Consequences

Static JSON/options blocks and brace-heavy examples compile without escaping
each brace. The parser, codegen, client DOM path, and prerender path are covered
as one round-trip contract. Existing templates are unchanged, and so is the
dynamic raw-HTML boundary, which is the sanitized `raw()` function (D174), not
this block.

**A raw block is formattable, so its outer whitespace is layout, not content.**
The whitespace-only text nodes at each end of a raw span have the raw flag
cleared and fall back to ordinary text handling; the raw content itself is never
rewritten. Without that demotion the newlines an author writes to indent a
multi-line `{#raw}` survived as real text vnodes, and every gate that counts
roots saw them — a `{#for}` body, a component template root, and a component
skeleton root all broke on a block that was formatted rather than written on one
line.
