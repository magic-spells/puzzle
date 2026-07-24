---
name: Render-function codegen
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
verified_at: '2026-07-22T01:03:36.670Z'
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
miscompiles to `__d.name.replace(/__d.a/__d.g,'b')`.

Emission covers host/component vnodes, coalesced text/interpolation,
formatters, dynamic/mixed attrs, events, slots, refs, islands, inline SVG,
conditionals/case, and item/range loops. Formatter calls use bracket access and
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
