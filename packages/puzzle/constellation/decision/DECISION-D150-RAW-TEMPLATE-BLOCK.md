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
  - DECISION-D167-COMPONENT-FAMILIES
  - DECISION-D174-STANDARD-FORMATTERS
verified_at: '2026-08-24T18:51:36.546Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
code_refs:
  - client-runtime/views/viewManager.js
---

# D150 — Raw template block: lex braces as literal text while preserving HTML

## Context

Template braces always enter Puzzle grammar, so static JSON, JavaScript, CSS or
samples of Puzzle syntax can't be written directly in a template. The `raw()` /
`escape()` functions run after the lexer and can't fix a lexer failure.

## Decision

`{#raw}…{/raw}` is a non-nesting lex-off block, legal only at text positions.
The first whitespace-tolerant closer wins (so `{/raw}` can't appear in the
body); opener content after `raw` is ignored, like `{#comment}`.

- **Braces are literal** inside the span: interpolations, block/branch tags and
  brace-valued event bindings are inert. **HTML stays live**: elements and
  static attributes become ordinary vnodes; void elements close as usual.
- **Splitter agrees with the lexer.** `findTemplateClose` (`sections.go`) uses
  the lexer's `isBlockRawOpen` / `scanBlockRaw` and skips the whole span, so
  quotes, `//`, `\{`, `<!--` and even a literal `</puzzle-view>` inside it are
  inert. The first close tag inside a skipped span is kept as a fallback when no
  close tag follows, so a missing `{/raw}` reports `unterminated {#raw}` at the
  opener rather than `missing </puzzle-view>`. The eslint/prettier vendored
  splitters mirror this.
- **Body text** becomes ordinary `Text` nodes; codegen emits string literals.
- **Attributes** inside the block are static literals. A brace-valued one still
  uses the JS-aware brace scan to find where its value ends (`data-json={ {"text": "}"} }`
  survives; an unbalanced quote is a positioned error) — only the span, never a
  meaning. `@`-prefixed names use the `@@` vnode-key escape so ViewManager and
  the SSG serializer write the authored name. No directive handling: `ref`,
  `island`, `key`, `flip` are omitted from the emitted vnode (the `@@` escape
  can't encode them); namespace checks don't apply.
- **Component grammar is inert**: `<slot>`, `<children>` and capitalized tags
  (`<Card/>`, `<Slot/>`, `<Portal>`) parse as plain elements, so samples show
  composition syntax without instantiating it or tripping
  [[DECISION-D167-COMPONENT-FAMILIES]] steering errors.
- **`@` shim is usage-gated (D89).** Any raw block in template or skeleton sets
  the over-inclusive `HasRawAt` scan bit → `__PUZZLE_HAS_RAW_AT__=true`, enabling
  ViewManager's `@@` branches and `setLiteralAtAttr`. Undefined means enabled.
- **Serialization** reuses parent-aware rules: normal text is entity-escaped in
  prerender; `script`/`style` take [[DECISION-D113-SSG-RAWTEXT-RULE]]'s RAWTEXT
  path, JSON scripts included. Client and prerender deliver the same
  `textContent`.
- **Outer whitespace is layout.** `demoteRawMarkerLayout` clears the raw flag
  on whitespace-only text at each end of the span, so a formatted multi-line
  block doesn't add roots to a `{#for}` body or component/skeleton root.

Use inside an attribute value is a positioned compile error.

## Alternatives

- One opaque text node — `<b>` would display as source.
- Parse normally and suppress known block tags — misses interpolation and
  future syntax.
- Entity-escape every prerendered body — corrupts script/style RAWTEXT.
- `{#raw}` as dynamic raw HTML — dynamic markup is the sanitized `raw()`
  function ([[DECISION-D174-STANDARD-FORMATTERS]]); the block stays static.
- Splitter scanning the raw body as brace groups — an unbalanced `{` or quote
  runs the JS-aware scan past `</puzzle-view>` and is quadratic on brace-heavy
  bodies.

## Consequences

Static JSON/options blocks and brace-heavy samples compile without per-brace
escaping; existing templates are unchanged. Parser, codegen, client DOM and
prerender are covered as one round-trip contract.
