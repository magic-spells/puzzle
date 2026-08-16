---
name: Template parser
status: verified
connections:
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
verified_at: '2026-08-16T04:34:18.080Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
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
case/when, item/range for, and marker nodes. Template comments are erased by the
lexer: inline `{## … }` uses brace-depth scanning and block
`{#comment}…{/comment}` discards raw, nestable content.

Raw blocks ([[DECISION-D150-RAW-TEMPLATE-BLOCK]]) reuse the comment block's
forward scan but preserve the body as one outer-lexer token. The parser owns the
needed parent context: under script/style it emits that span as one literal Text
node; elsewhere a nested brace-disabled HTML lexer builds ordinary element/text
nodes. Attribute tokens from that nested pass are static; an `@`-prefixed name
carries a literal-name bit so it cannot become an event. Raw blocks do not nest
and are rejected at attribute-value positions. Because their expanded AST is
otherwise indistinguishable from ordinary markup, the synthetic template or
skeleton root also records that at least one raw block was parsed; D89's usage
scan consumes that deliberately over-inclusive fact to retain the literal-`@`
client shim.

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
Non-event names containing `:` are reserved unless their prefix is `xml`,
`xlink`, or `xmlns`; invalid namespaces fail at the attribute name's source
position. `checkAttrNamespace` runs in both attribute loops (element tags and
section tags) at the NAME, before the `=` branch — the valued and valueless
spellings must reject identically, and validating inside `buildAttr` reaches only
the valued one. Event names are exempt: the colon is their modifier channel, and
`parseEventModifiers` owns it. Parser helpers enforce event/modifier grammar (generic modifiers:
`prevent`, `stop`, `once`, and since D86 `outside` — valid on any event; key
filters stay keyboard-only), static islands, literal inline SVG roots/paths,
list identifiers/keys, and unique static refs.

Composition grammar (D134/D141/D144): `<Children>` is the default marker,
`<Slot>` is the router outlet, `<Slot name="x">` is a named marker, and
`<Portal>` is the teleport marker. All three tag names are reserved before
component resolution, and none of the reservations apply inside `{#raw}`, where
every tag is literal sample markup. `<Children>`/`<Slot>` are
self-closing (no fallback) or paired — the body is fallback content, parsed
as ordinary template children, with a marker nested inside another marker's
fallback a positioned compile error; lowercase `<children>`/`<slot>`/`<portal>`
are positioned steering errors. `<Portal>` is paired-only (it exists to carry
the children it teleports), takes no attributes — `to`/`name` get a
named-outlets-not-supported message and `ref` the render-target message — and
cannot appear inside an island or inside a marker's fallback body. Slot names
stay static, non-empty, reserved-name checked, and unique per template body, and
the default marker is unique per body too. Call-site named fills must be direct
static `slot="x"` children, while default forwarding may appear inside a
component invocation. Components/markers are forbidden inside islands; refs
are forbidden on components, markers, roots, loops, and skeletons.

`ParseError` includes file and one-based line/column. Cross-nesting and
did-you-mean diagnostics report the actionable source position.
