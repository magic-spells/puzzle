---
name: Template parser
status: verified
connections:
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
verified_at: '2026-07-22T00:04:07.972Z'
---

# Template parser

HTML-aware lexer and recursive-descent parser for `.pzl` files. It returns a
positioned AST or an error list; there is no partial/best-effort output.

`SplitSections` recognizes one `<puzzle-view>`, optional `<script>`, optional
`<style>`, and optional `<puzzle-skeleton>`. Scripts remain opaque bytes.
Section closing scans are quote/comment/template/interpolation aware, including
literal close-tag text inside template comments and skeleton bodies. Scripts
accept absent/`lang="js"`/`lang="ts"`; styles accept only bare `scoped`;
skeletons accept only a static integer `min-duration`.

The lexer emits elements/components, text, interpolation, if/unless/else-if,
case/when, item/range for, and slot nodes. Template comments are erased by the
lexer: inline `{## … }` uses brace-depth scanning and block
`{#comment}…{/comment}` discards raw, nestable content.

One shared balanced scanner handles expressions in templates and attributes,
skipping JS strings, regexes, comments, and nested template-literal
interpolations. Top-level split helpers recognize formatter pipes/arguments,
loop counters, range ellipses, and case values without confusing nested JS.
Object literals remain outside the template-expression subset and get a
positioned error. The scanner's regex/division disambiguation must stay in
lockstep with [[COMPONENT-CODEGEN]]'s expression scanner; a mismatch splits
`{ /a|b/.test(name) }` at the regex's `|` as a formatter pipe.

Attributes are static, dynamic, mixed, event, or valueless-static values.
Parser helpers enforce event/modifier grammar (generic modifiers: `prevent`,
`stop`, `once`, and since D86 `outside` — valid on any event; key filters stay
keyboard-only), static islands, literal inline SVG roots/paths, list
identifiers/keys, and unique static refs.

Composition grammar is current D74: `<children/>` is the default marker and may
carry fallback children; `<slot name="x">` is named-only; `<Slot/>` is a bare
router outlet; lowercase bare `<slot/>` is an error. Call-site named fills must
be direct static `slot="x"` children, while default forwarding may appear
inside a component invocation. Components/slots are forbidden inside islands;
refs are forbidden on components, slots, roots, loops, and skeletons.

`ParseError` includes file and one-based line/column. Cross-nesting and
did-you-mean diagnostics report the actionable source position.
