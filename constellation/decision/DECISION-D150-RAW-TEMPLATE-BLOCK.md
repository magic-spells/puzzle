---
name: 'D150 — Raw template block: lex braces as literal text while preserving HTML'
status: built
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
literals and never sends it through expression resolution. A brace-valued
attribute inside the block is static. A literal attribute whose name begins
with `@` uses a private vnode-key escape so ViewManager and the SSG serializer
write the authored name instead of treating it as a listener directive.

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
