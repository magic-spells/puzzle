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
verified_at: '2026-08-15T06:05:58.384Z'
verified_sha: 61a37ae80b9104220be7d20d2ca9a4660cb4ec2f
---

# D150 — Raw template block: lex braces as literal text while preserving HTML

## Context

Template braces always enter Puzzle grammar, so static JSON, JavaScript, CSS,
and examples containing literal block syntax cannot be written directly in a
template. Value-level `escape`, `raw`, and `noescape` formatters run after the
lexer and cannot solve a lexer failure. `{#comment}` already proves that a block
body can be located without lexing it, but comments discard that body.

## Decision

`{#raw}…{/raw}` is an additive, non-nesting lex-off block. The scanner locates
the first whitespace-tolerant closer without inspecting the body. While inside
that span, braces are literal bytes: interpolation, block/branch tags,
formatter pipes, and brace-valued event bindings do not activate Puzzle
grammar. HTML tokenization remains active, so elements and their static
attributes still become ordinary vnodes. Opener content after `raw` is ignored,
matching `{#comment}`.

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
  block and no runtime value can reach it; dynamic HTML injection remains
  deferred.

## Consequences

Static JSON/options blocks and brace-heavy examples compile without escaping
each brace. The parser, codegen, client DOM path, and prerender path are covered
as one round-trip contract. Existing templates and the deferred dynamic raw-HTML
boundary are unchanged.
