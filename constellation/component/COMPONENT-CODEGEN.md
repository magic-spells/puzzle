---
name: Render-function codegen
status: built
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
verified_at: '2026-07-24T23:40:00.000Z'
verified_sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
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
---

# Render-function codegen

Transforms the parser AST into one ES module: the user's script bytes, compiler
imports, and `ClassName.prototype.render = function () { … }`. The user class
body is never rewritten. Class extraction is LexSkip-aware and requires a real
named `export default class … extends …` declaration.

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
formatters, dynamic/mixed attrs, events, slots, refs, islands, inline SVG,
conditionals/case, and item/range loops. D134 markers emit only
`new ViewNode(SLOT_TAG)` or `new ViewNode(SLOT_TAG, { name })`; fallback
child arrays are not part of the grammar or emission. Formatter calls use bracket access and
the runtime missing-name guard. Item loops auto-key through `ViewNode.keyOf`;
an explicit root `key` replaces the synthetic key. Valueless attrs follow a
strict contract: a bare attribute emits `true`, an explicit `=""` emits an empty
string (a former bug compiled `value=""` to `true` and rendered "true").

Data-independent event sites cache one closure per instance in `this.__h`,
stabilizing DOM listeners and callback props. Sites that capture model or loop
values emit fresh closures so their captured values stay correct. Modifiers
remain encoded in vnode attribute names for ViewManager to apply.

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
vnode, and registers the file with esbuild watch inputs. Scoped styles share a
stable app-relative path hash with the plugin's `@scope` wrapper.

Golden tests byte-compare focused fixtures plus the canonical todos output and
syntax-check emitted JavaScript. The conditional-arity suite pins nested and
unequal branch behavior plus the stability gate (item-form loops, explicit-key
range loops, and slot markers disable padding).
