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
  - kind: decision
    text: >-
      Whitespace policy amendment ([[DECISION-D168-TEXT-RUN-WHITESPACE]], 0.7.0 final review):
      `processText` now reports whether it stripped a leading/trailing space because the run held a
      newline, and `buildTextRun` re-inserts exactly one space at any run-INTERNAL boundary where a
      stripped edge borders another run member (a dropped whitespace-only newline node sets the pad
      on the previous segment). The space folds into the neighbouring static literal when there is
      one. Run edges keep the old strip, so element-boundary indentation and every golden file are
      byte-identical; compiled across all 581 `.pzl` files in the repo, only
      `examples/stays/app/views/Listing.pzl` changed (`' ·'` → `' · '`). Raw-block segments
      participate as static segments, so a neighbouring stripped edge's pad can prepend into a raw
      literal — byte-identical to a separate `' '` segment. Pinned by `text_run_space_test.go`.
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
The reserved-binding check covers what the compiler **declares** as well as what
it imports: `ViewNode`, `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG`, `__s`, `__l`
and the `{#svg}` shared-asset locals, plus the `__L<n>` list-block meta consts a
template with an item-form `{#for}` hoists to module scope. Each produces a
positioned error naming the emission and why *this* file makes it.

Mode comes from the app-relative path. Views/layouts preserve the
`<puzzle-view>` root; inline components require one render root and do not emit
a wrapper.

Expression scoping is a **scopeMap** — a name mapped to the JavaScript it
resolves to. An unmapped identifier is prefixed as model data (`__d.x`); a
mapped one resolves to its value, which is how a loop local becomes the row
scope's member (`todo` → `s.item`, a counter → `s.i`) through every consumer at
once, and how `event`, `this`, JS keywords/globals, numeric literals and
template-literal static text stay intact. An in-scope binding shadows a
keyword-ish global, so a `{#for document of docs}` row reads `s.item`, not
`window.document`. Reads of names imported by the script emit a warning because
imports are not template scope.

The same single scan also **classifies** what an expression read — the data
roots it touched, the loop item's members at depth one, whether it reached
deeper or through a call, and whether it used `this` — so a loop site's meta is
derived from exactly the lexical rules that rewrote it, with no second pass and
no second scanner to keep in sync. Facts are collected only inside a lowered
loop body and never during a look-ahead pass (conditional arity, `{#for}` root
extraction), which re-resolve expressions in a scope they will not be emitted
in.

A second out-of-band diagnostic family (D82, `a11y.go`) walks the fresh template
+ skeleton ASTs before `{#svg}` resolution and warns — never errors — on five
conservative accessibility mistakes (img/input-image `alt`, iframe `title`, `a`
`href`, static positive `tabindex`); any static/dynamic/mixed attr counts as
present, and generated JS stays byte-identical. The expression scanner
disambiguates regex literals from division and must stay in lockstep with
[[COMPONENT-TEMPLATE-PARSER]]'s scanner; otherwise `name.replace(/a/g,'b')`
miscompiles to `__d.name.replace(/__d.a/__d.g,'b')`. Both of this package's
literal scanners clamp their `j += 2` escape skip at the input length, matching
the parser's — an unterminated literal must end at exactly `len(expr)`, since
the copy path slices `expr[i:j]`.

Emission covers host/component vnodes, coalesced text/interpolation,
formatters, dynamic/mixed attrs, events, slots, snippets, portals, refs,
islands, inline SVG, conditionals/case, and item/range loops. Markers emit
`new ViewNode(SLOT_TAG)` with optional `name`, per-render `args`, and fallback
children. Caller `<Snippet>` declarations emit `SNIPPET_TAG` metadata vnodes:
their ordered `params` plus a fresh `fn({ ...params })` closure whose body keeps
caller scope while parameters shadow it. `<Portal>` (D144) emits one
`PORTAL_TAG` vnode carrying the teleported children through that same
child-emission path; a component template whose ROOT is a `<Portal>` is a
positioned error steering to a wrapper element. **The injected import line is
built per file from what the file actually needs** — that is the tree-shaking
contract, not a tidiness preference: `ViewNode` always, `SLOT_TAG` when a marker
is present, `SNIPPET_TAG` when a Snippet is present, `PORTAL_TAG` when a portal
is, `displayValue as __s` when an interpolation coerces for display, and
`listRows as __l` when the file lowers at least one item-form `{#for}` (last in
that order). A runtime module reachable only through such an import is absent
from an app whose templates never emit it, which is why `views/listBlock.js`
must never be imported from inside `client-runtime/` — see [[FILE-LIST-BLOCK]].

**Item-form loops lower to persistent list blocks** (`listblock.go`,
[[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). The `.map(…)` becomes
`__l(this, owner, id, coll, (s) => …, __L<id>)` in place, with the same
surrounding layout — first argument the view, second the owner the rows hang off
— and the site's static facts travel in a module-scope
`const __L<id> = { key, counter?, ctrl?, roots?, fields?, deep?, volatile? }`
emitted after the injected import line — non-default fields only, in a fixed
order, so the common site is one short const. The key function carries D58's
resolver (`(todo) => ViewNode.keyOf(todo)`) or an explicit `key=` rewritten
against the arrow's own parameters; a key that reads `__d`, `__f` or `this`
cannot live at module scope, so that site keeps `.map` entirely. The row root
always carries the block's `key: s.k` (the author's `key` attribute is dropped,
having become the meta's function), loop locals resolve through the scope map,
nested loops take the enclosing row as owner and shadow as `s1`, `s2`, … by
depth, and `Class.__roots = […]` is stamped after the module marker when any
site carries a root mask — capped at 31 entries, past which a site degrades to
`volatile`. Range loops and loops inside a `<Snippet>` body are not lowered:
a snippet body is stamped fresh per expansion, so a block keyed by site id
would be shared between stamps.

**Maximal static subtrees are cache sites** (`staticcache.go`): a subtree whose
every vnode has only static attributes (`ref`, `key`, `island` and `flip`
included — per-instance stable — plus `@event` values the D62 rule already
caches), literal text and static element children emits as
`(this.__c[n] ??= new ViewNode(…))` at view level or `(s.c[n] ??= …)` inside a
row, so it is allocated once per owner. The threshold is three or more vnodes —
**or an `island` element's children array at any size, whatever it contains.**
The island case is the one cache site with no static requirement, because
[[DECISION-D44-DOM-ISLANDS]] seeds those children once at mount and forbids the
patcher from ever reconciling them again; a `{#for}`, an interpolation or a
handler inside a seed is a mount-time value by that contract, and a component or
composition marker inside an island is already a compile error. When the
island's sole child is a `{#for}`, the wrapper goes round the lowered list call
itself and the block runs once. Excluded: anything inside an already-wrapped
subtree (only the maximal one is cached — the depth guard keeps a lowered loop
inside a cached island seed from taking a wrapper of its own), snippet bodies
(no owner to cache on), a subtree holding a controlled `value`/`checked` (the
runtime re-asserts those against the live DOM every pass), and the render root,
which the root emitters never route through the wrapper. The wrapper is a pure
prefix on the subtree's first line with a `)` suffix on its closing line, and
the prefix counts toward `startCol` in the `attrsMultiline` width decision, so
a wrapped element wraps its attributes exactly as the fixture does.

Data-independent event sites cache one closure per instance in `this.__h`,
stabilizing DOM listeners and callback props. A site inside a lowered loop whose
arguments capture only that loop's locals caches on the **row scope** instead —
`(s.h<n> ??= (event) => this.events.x(s.item))`, counted per site — so the
closure is identity-stable across renders and reads the row's current item at
fire time; a capture of a range-loop variable or a snippet parameter stays
fresh, because those bindings are re-created per iteration or per expansion.
Sites whose arguments read model data keep fresh closures so their captured
values stay correct, and the roots they read count toward the enclosing loop
site's mask. A `this.…` argument is evaluated at fire time and never makes a
site volatile. Modifiers remain encoded in vnode attribute names for ViewManager
to apply.

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
Inside a lowered row the bind target resolves through the same scope map, so a
member path rooted at the loop variable writes to `s.item` — the live record,
not a render-time copy. The bind attr name is matched case-SENSITIVELY
(`value`/`checked`), because the runtime's property-write lookup is; a
`VALUE={ x }` spelling stays a plain one-way attribute rather than a bind the
runtime would never honor.

Conditional branches are arity-stabilized when occupancy is provably fixed.
`if`/`unless`/`case` compute their maximum static child count recursively and
pad shorter/implicit-empty branches with `new ViewNode('#')` — but only when
every branch is stable. An item-form loop (its row key can resolve to null →
unkeyed positional rows), a range loop whose body root carries an
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
the row key a `{#for}` gives its body root. The read + scan is
memoized per absolute path in an optional build-scoped `SVGCache`
(`Options.SVGCache`), which the esbuild plugin also shares with its shared-asset
virtual module loader — so an icon used at N sites across M files and three
passes is read and parsed once, not 3N+1 times. The scan is NOT skipped in dedup
mode even though `emitRawSVG` discards the attrs there: "valid" is defined by the
scan, and a `<div>` root must still fail the .pzl compile with a ParseError
positioned inside the SVG. Memoized scans hand out a COPY of the attr slice —
`forBody` rewrites the root's `key` attribute, which would otherwise write
through into every other use site. Scoped styles share a
stable app-relative path hash with the plugin's `@scope` wrapper.

Golden tests byte-compare focused fixtures plus the canonical todos output and
syntax-check emitted JavaScript. The conditional-arity suite pins nested and
unequal branch behavior plus the stability gate (item-form loops, explicit-key
range loops, and slot markers disable padding); `listblock_test.go` and
`static_cache_test.go` pin the lowering — item/explicit-key/counter/nested/
conservative meta, the `listRows as __l` import appearing only for a file that
lowers a site, the cache threshold, the island-seed cases and every exclusion —
and the todos fixtures remain the byte contract the emitter is matched to, not
the other way round.
