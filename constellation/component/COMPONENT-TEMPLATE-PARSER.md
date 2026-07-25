---
name: Template parser
status: verified
connections:
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
verified_at: '2026-07-24T23:40:00.000Z'
verified_sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
notes:
  - kind: gotcha
    text: >-
      Nested <style> elements are legal template markup (verified during D113), but the template
      brace grammar applies inside them: `.a > .b { color: red }` compiles to invalid JS
      (`String(__d.color: __d.red)`) because `{ … }` is an interpolation everywhere in a template.
      Authors must escape the braces (`\{ \}`), which compiles correctly. Same applies to braces in
      nested <script> bodies. Pre-existing behavior, not a D113 change — docs/error-message
      improvement candidate.
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

Every literal scanner clamps its escape skip at `len(s)`. The `j += 2` that
steps over `\x` must not run past EOF on a literal whose last byte is a
backslash: the contract is that an unterminated literal returns exactly
`len(s)`, and callers slice `s[i:end]` and index `s[end-1]`. Unclamped, a `.pzl`
ending in `{/a\` returned `len(s)+1` and killed `puzzle build` with a Go panic
instead of a positioned "unclosed `{`" error. Four scanners share the rule —
two here, two in [[COMPONENT-CODEGEN]] — and they must be fixed together.

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
refs are forbidden on components, slots, roots, loops, and skeletons. The island
walk descends **through slot markers too** — a `<children>…</children>` or
`<slot name="x">…</slot>` fallback body is ordinary content that renders when the
slot goes unfilled, so an island (or a component inside one) declared there is
just as real as anywhere else. Missing that case let such a component compile
clean and then be frozen after mount: the orphaned-instance corruption the check
exists to prevent.

`ParseError` includes file and one-based line/column. Cross-nesting and
did-you-mean diagnostics report the actionable source position.
