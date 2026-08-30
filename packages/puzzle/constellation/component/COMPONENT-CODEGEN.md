---
name: Render-function codegen
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: gotcha
    text: >-
      Two independent JS scanners exist and MUST agree: parser/lexskip.go (LexSkip, a skipper) and
      codegen/expr.go (resolveExpr, a rewriter). They carry byte-identical regex-preceding-keyword
      tables under different names with no shared symbol, and scanRegexLiteral has a twin in
      lexskip.go. That sync was manual and undefended, and it silently drifted: neither scanner
      handled postfix ++/-- , so `a++ / b` read the `/` as a regex opener. In the parser that
      surfaced as `missing </script>` pointed at the tag five lines away; in the rewriter it
      produced NO diagnostic at all — `{ a++ / b / c }` compiled clean and emitted `String(__d.a++ /
      b / __d.c)` with `b` unscoped, failing at runtime with ReferenceError.


      The fix had to be a 2-byte munch in LexSkip returning pee = prevEndsExpr, NOT a change to
      LexPlainEndsExpr: that helper's signature is (c byte, prev bool) with no lookahead, so a
      per-byte "neighbour is also +" heuristic cannot express it and would misclassify
      `a+++/re/.source`, which is valid JS meaning `a++ + /re/.source` where the slash genuinely
      does open a regex.


      A differential corpus test now runs both scanners over shared fixtures and asserts identical
      regex/division classification. Keep it: it is the only thing standing between the two scanners
      and the next silent drift. The larger unification (a byte-preserving token/span API
      resolveExpr could consume) is deliberately NOT done — resolveExpr rewrites rather than skips,
      which is why it is the holdout. Note codegen already imports parser and routes five other call
      sites through LexSkip, so there is no layering obstacle if that refactor is ever funded.
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: state
    text: >-
      `ScopedCSS(filename, styles)` now owns the D59 `@scope ([data-<scopeId>]) { … }` wrapper text
      next to `ScopeID`, which derives the id. The esbuild plugin calls it during a real build and
      the playground WASM compiler calls it in the browser (D164), so the two cannot drift; the
      emitted bytes are unchanged.
---

# Render-function codegen

Transforms the parser AST into one ES module: the user's script bytes, compiler
imports, and `ClassName.prototype.render = function () { … }`. The user class
body is never rewritten. Class extraction is LexSkip-aware and requires a real
named `export default class … extends …` declaration.

The `<script>` body is tokenized ONCE per compile (`tokenizeJS`, scriptcollide.go)
and the one stream feeds all three consumers that used to lex those same bytes
independently: class-name extraction, the import-collision warning scan, and the
reserved-binding check. Tokens carry a `comment` bit because the consumers
disagree about opaque units — a comment is whitespace to the class-keyword
adjacency rule (`export default /* x */ class Foo {}` is a declaration) while a
string or regex breaks it, and the binding scans treat every opaque unit alike.

Mode comes from the app-relative path. Views/layouts preserve the
`<puzzle-view>` root; inline components require one render root and do not emit
a wrapper. Scope-aware expression rewriting prefixes model identifiers while
leaving loop bindings, `event`, `this`, JS keywords/globals, numeric literals,
and template-literal static text intact. Reads of names imported by the script
emit a warning because imports are not template scope. A second out-of-band
diagnostic family (D82, `a11y.go`) walks the fresh template + skeleton ASTs
before `{#svg}` resolution and warns — never errors — on five conservative
accessibility mistakes (img/input-image `alt`, iframe `title`, `a` `href`,
static positive `tabindex`); any static/dynamic/mixed attr counts as present,
and generated JS stays byte-identical. The expression scanner
disambiguates regex literals from division and must stay in lockstep with
[[COMPONENT-TEMPLATE-PARSER]]'s scanner; otherwise `name.replace(/a/g,'b')`
miscompiles to `__d.name.replace(/__d.a/__d.g,'b')`. Both of this package's
literal scanners clamp their `j += 2` escape skip at the input length, matching
the parser's — an unterminated literal must end at exactly `len(expr)`, since
the copy path slices `expr[i:j]`.

Emission covers host/component vnodes, coalesced text/interpolation,
formatters, dynamic/mixed attrs, events, slots, scoped Templates, portals, refs,
islands, inline SVG, conditionals/case, and item/range loops. Markers emit
`new ViewNode(SLOT_TAG)` with optional `name`, per-render `args`, and fallback
children. Caller `<Template>` declarations emit `TEMPLATE_TAG` metadata vnodes:
their ordered `params` plus a fresh `fn({ ...params })` closure whose body keeps
caller scope while parameters shadow it. `<Portal>` (D144) emits one
`PORTAL_TAG` vnode carrying the teleported children through that same
child-emission path; a component template whose ROOT is a `<Portal>` is a
positioned error steering to a wrapper element. The injected import line is
built per file from what the file actually needs: `ViewNode` always, `SLOT_TAG`
when a marker is present, `TEMPLATE_TAG` when a scoped Template is present,
`PORTAL_TAG` when a portal is, and `displayValue as __s` when an interpolation
coerces for display.

Raw-block bodies arrive as static Text/Element AST nodes whose text carries the
parser's `Raw` bit, so their text takes only the JS-string path and never
expression resolution — and a `Raw` text segment bypasses the template
whitespace policy, emitting its bytes exactly as authored (a JSON blob or
`<pre>` body inside `{#raw}` survives byte-for-byte). A literal `@name`
attribute — from raw markup or from an `{#svg}` asset root — is emitted under
the private `@@name` vnode key on host elements; [[COMPONENT-VIEW-MANAGER]] and
[[COMPONENT-SSG]] decode that key back to the authored DOM attribute without
entering listener logic.

Data-independent event sites cache one closure per instance in `this.__h`,
stabilizing DOM listeners and callback props. Sites that capture model or loop
values emit fresh closures so their captured values stay correct. Modifiers
remain encoded in vnode attribute names for ViewManager to apply.

Implicit two-way binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) lives in
`binding.go`: `classifyBindExpr` accepts exactly `ident`/`ident.ident` (keyword,
global, and reserved-`event` roots never classify; a bare loop variable never
classifies, a loop-var-rooted member path does) and `detectAutoBind` applies the
element-level conditions (form-control tag, no author `@input`/`@change`, no
static `readonly`/`disabled`, no `multiple` on a `<select>`, static
classifiable `type`). Both `attrsMultiline`
and `emitAttrs` consume it — inline SVG calls that pair directly — appending
`'@<event>:bind': this.__bind(target, field, spec)` after the authored attrs.
The synthesized attr counts toward the width trial (layout stays deterministic)
and consumes no `__h` site index; `attrKV` runs twice per attr, so a counter
there would drift every golden. Non-classifying templates emit byte-identically.
The bind attr name is matched case-SENSITIVELY (`value`/`checked`), because the
runtime's property-write lookup is; a `VALUE={ x }` spelling stays a plain
one-way attribute rather than a bind the runtime would never honor.

Conditional branches are arity-stabilized when occupancy is provably fixed.
`if`/`unless`/`case` compute their maximum static child count recursively and
pad shorter/implicit-empty branches with `new ViewNode('#')` — but only when
every branch is stable. An item-form loop (its `ViewNode.keyOf` row key can be
null → unkeyed positional rows), a range loop whose body root carries an
explicit author `key`, or a slot marker (runtime expands it to 0..N nodes)
makes the whole conditional emit unpadded, byte-identical to the pre-padding
form — padding there could pair a placeholder against a real trailing sibling
and remount it. A generated-key range loop stays stable and counts as zero
slots. Balanced branches emit unchanged.

Inline SVG reads one app asset, validates a literal root, emits an island SVG
vnode, and registers the file with esbuild watch inputs. Root attrs from the
asset file are authored literals, never framework directives: every root attr
is stamped literal-name, reserved names (`ref`, `island`, `key`, `flip`) are
dropped before emission, an `@name` decodes through the `@@name` escape as a
plain DOM attribute, and a literal `key` on the asset root does not suppress
the synthetic `{#for}` key. The read + scan is
memoized per absolute path in an optional build-scoped `SVGCache`
(`Options.SVGCache`), which the esbuild plugin also shares with its shared-asset
virtual module loader — so an icon used at N sites across M files and three
passes is read and parsed once, not 3N+1 times. The scan is NOT skipped in dedup
mode even though `emitRawSVG` discards the attrs there: "valid" is defined by the
scan, and a `<div>` root must still fail the .pzl compile with a ParseError
positioned inside the SVG. Memoized scans hand out a COPY of the attr slice —
`forBody` prepends a synthetic loop `key`, which would otherwise write through
into every other use site. Scoped styles share a
stable app-relative path hash with the plugin's `@scope` wrapper.

Golden tests byte-compare focused fixtures plus the canonical todos output and
syntax-check emitted JavaScript. The conditional-arity suite pins nested and
unequal branch behavior plus the stability gate (item-form loops, explicit-key
range loops, and slot markers disable padding).
