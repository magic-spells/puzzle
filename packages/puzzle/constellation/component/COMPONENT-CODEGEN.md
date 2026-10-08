---
name: Render-function codegen
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D62-HANDLER-CACHING
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# Render-function codegen

Transforms the parser AST into one ES module: the user's script bytes (never
rewritten), compiler imports, and `ClassName.prototype.render = function () { … }`.
Mode comes from the app-relative path: views/layouts keep the `<puzzle-view>` root;
inline components need exactly one render root and emit no wrapper. A script-less
inline component ([[DECISION-D173-CORE-SEMANTICS]] V15) gets a synthesized class whose
`data(params, props)` returns `props`; a script-less view or layout gets an empty class.

## The script stream (`scriptcollide.go`, `classname.go`)

The `<script>` body is tokenized ONCE (`tokenizeJS`) and feeds class-name extraction,
the import-collision warning and the reserved-binding check. Tokens carry a `comment`
bit and remember line terminators in preceding whitespace/comments for selector ASI.
A comment is whitespace to the class-keyword adjacency rule
(`export default /* x */ class Foo {}` is a declaration); a string or regex breaks it.
Class extraction requires a real named `export default class … extends …`.

- **Reserved bindings** cover what the compiler imports or declares: `ViewNode`,
  `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG`, `__dc`, `__s`, `__l`, `__e`, `__r`, the `{#svg}`
  shared-asset locals and the hoisted `__L<n>` list-block metas. A clash is a
  positioned error naming the emission.
- **Names are Unicode JS identifiers** ([[DECISION-D176-EXPRESSION-LANGUAGE]] rule 8,
  `jsident.IsIDStart`/`IsIDContinue`). `parser.LexSkip` (used for the script only;
  template expressions never pass through a text scanner) reads only ASCII, so
  `identRunEnd`/`startsNonASCIIIdent` (expr.go) carry a run through non-ASCII runes.
- A script-less file's class comes from its filename (`classNameFromFilename`: bad runes
  → `_`, `_` prefix when the first rune can't start an identifier or is reserved).
- **A class name the scan can't read to its end is a positioned error** (`nameCut`):
  a `\u` escape or a non-space non-ASCII byte right after it (e.g. U+30FB, newer than
  Go's Unicode tables) would bind the render tail to a cut name. `puzzle check` reads the
  name back from the render tail (`compiledClassName`), counting every byte ≥ 0x80.
- These two files have no FILE card; this card is their contract.

## Expressions (`lower.go`)

The parser attaches a parsed tree (`puzzle-lang/expr`) to every expression position and
codegen lowers the tree; nothing reads source strings except `startsWithObjectLiteral`.
The lowering table in `lower.go`'s header comment is the contract; the language rules are
D176 and [[DOC-SPEC-TEMPLATE]]. Non-obvious points:

- **scopeMap** maps an in-scope binding to its JS: `""` = bare (range var, snippet param,
  `ViewNode`), otherwise a rewrite (row `todo` → `s.item`, counter → `s.i`, mangled
  `__pzl<name>`). Arrow params shadow bindings, which shadow a handler's `event`; every
  other name is `__d.<name>` — including `event` outside a handler.
- **Selector scope (D180):** `<Component>` `is` adds module imports and simple declared identifiers below loop/snippet/arrow bindings and above data. Props and spread operands retain ordinary data scope. The conservative token scan includes subsequent `const`/`let`/`var` declarators, including an uninitialized final name terminated by a line break or EOF through ASI, but not destructuring patterns; use a simple alias or `data()` for those values. It never rewrites the script or permits arbitrary script calls. Only a selector read of a module `let`/`var` binding marks enclosing cached row blocks volatile. Imports and `const` bindings preserve normal row caching; in-place edits to a const map's entries are not observed by cached rows.
- **`event` read both as data and as the DOM event in one template is an error**
  (`checkEventUses`, after render + skeleton emission). A loop/snippet/arrow binding
  named `event` counts as neither. The DOM param is renamed `__ev` when a binding owns
  `event`.
- **Guards** (D173 V4): every member, index and method step is written optional, handler
  arguments included. Written as authored: a handler's free `event` chain and `ViewNode`.
  `Object.keys/values/entries` get `(<arg> ?? {})` (`objectGlobalArgs`, render only).
- **Calls**: a bare call is the library, `(__f["name"] || __f.__missing("name"))(…)`
  (the `const __f` line only when used); methods and allowed globals are verbatim.
  Parentheses come from precedence, never source spacing. An expression position that
  STARTS with an object literal is an error (ambiguous with interpolation braces).
- **Handlers** (`lowerer.handler`): `h` → `(event) => this.events.h(event)`; `h(a, b)` →
  the view's handler, never the library (D176 rule 4); a conditional of those or `null`;
  or `null`. `HandlerForms` is the ONE definition of an @event value's own calls, shared
  by the lowering, `checkHandler` and `plugin.handlerOwnCalls` — a second copy would let
  the usage scan count a view handler as a library call.
- **Check target** (`WriteCheckValue`/`WriteCheckEvent`, `CheckWriter` maps every token
  back to its `.pzl` offset): no added guards or `?? {}`; standard call →
  `__puzzle_fn.name(…)`; app call → `__puzzle_app_fn("name")(…)` (a call, not an index
  signature, so it passes `noUncheckedIndexedAccess`); arrow-taking method receivers via
  `__puzzle_check_list(…)`; bare handler → `this.events.name`.

**Lists that must move together:** `codegen.LibraryFunctionNames` (the 21 names: the
runtime's 19 built-ins + `link` + `t`), `check.libraryFunctionSignatures`
(`TestLibrarySignaturesMatchCodegen`) and `LibraryFunctions` in `types/index.d.ts`; the
runtime mirrors them in `STANDARD_FORMATTERS` + `PUZZLEKIT_FORMATTERS`
(client-runtime/formatters.js). `clockFunctions` (`timeago`) is the only clock-reading
built-in.

## Checks before emission (`markup.go`, `presets.go`, `a11y.go`)

`checkTemplateExprs` walks template + skeleton first so emitters can trust every tree:

- **Markup placement** ([[DECISION-D174-STANDARD-FORMATTERS]]): `raw`/`newline_to_br`
  only as the outermost call of a text interpolation with one argument; an error anywhere
  else, inside a raw-text element (`<script>`, `<style>`, `<textarea>`, `<title>`, …) and
  in foreign content (`<svg>`/`<math>` down to `<foreignObject>`). Context carries through
  component children and snippet bodies; only `<Portal>` resets it. Lowered by
  `emitMarkup` to `new ViewNode('#html', { value, br? })`; the name never reaches `__f`.
- **Literal presets** (`checkLiteralArgs`): an unknown literal preset for
  `date`/`time`/`datetime`, or an impossible literal `in_timezone` zone, is a **warning**
  (an app may register its own function under those names).
- **`this`**: safety net behind the parser; `thisMsg` must stay word-for-word equal to
  puzzle-lang's `expr.msgThis`.
- **Handler/library collision** (`checkHandler`): non-fatal warning.
- **a11y** (D82): five conservative warnings on the pre-`{#svg}` AST; output unchanged.

## Emission

**The import line is built per file from what it uses** — the tree-shaking contract:
`ViewNode` always; then `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG`, `displayValue as __s`,
`dynamicComponent as __dc`, `listRows as __l`, `loopItems as __e`, `loopRange as __r` (in that order) only when
emitted. So `views/listBlock.js` must never be imported from inside `client-runtime/`
([[FILE-LIST-BLOCK]]).

- Markers emit `ViewNode(SLOT_TAG)` with `name`, per-render `args` and a lazy
  `fallback: () => […]` thunk (D141) that a filled marker never runs. `<Snippet>` emits
  `SNIPPET_TAG` with ordered `params` and a `fn({...params})` closure keeping caller
  scope. `<Portal>` emits one `PORTAL_TAG`; a Portal as a component's ROOT is an error.
- **Runtime component selection** (`component.go`, [[FILE-CODEGEN-COMPONENT]]): a reserved `Component` invocation emits `dynamicComponent as __dc`, imported only when used. Children are normal default-slot content; `is={ cards[key] }` is ordinary expression lookup. Other attrs, including `name` and `from`, use normal data-scoped props/events plus source-ordered `SpreadAttr` emission. Missing/non-expression and non-component literal `is`, an authored `flip` attribute, and a user `Component` file/tag binding get positioned rename/usage errors. `Component.*` is reserved at the parser. The check emitter (`compiler/internal/check/component.go`) preserves selector scope in its TypeScript mirror.
- **Loop domain is guarded** (D173 V12): `__e(coll).map(…)` / `__r(from, to).map(…)`, so
  a missing collection loops zero times. Integer-literal ranges fold: an array literal
  up to 16 items, `Array.from` beyond, `[]` when end < start — no `loopRange` import.
- **Whitespace** ([[DECISION-D168-TEXT-RUN-WHITESPACE]]): `processChildren` classifies one
  children list; each coalesced run knows whether each edge borders a sibling node or the
  parent edge, and `buildTextRun` restores one space at every stripped edge except a
  parent edge. `<pre>`/`<textarea>` bodies are verbatim under the `preserveWS` counter.
  **Every walker that descends into children and calls `processChildren` must raise it for
  those tags** — today `emitElement` and `staticSubtree` — or the static-cache look-ahead
  counts different text vnodes than emission. `preservedBody` drops the one newline after
  the start tag; `forBodyRoot` zeroes the counter for the loop body's own list.
- A `#html` markup vnode is a non-text sibling for D168 and dynamic to the static cache.

## List blocks (`listblock.go`)

Item-form loops lower to persistent list blocks
([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]): `__l(this, owner, id, coll, (s) => …, __L<id>)`
in place, with static facts in a module-scope `const __L<id> = { key, counter?, ctrl?,
roots?, fields?, deep?, volatile? }` (non-default fields only, fixed order). The key
function is hoisted; a key that reads a data root or a library call can't live at module
scope, so that site keeps `.map`. The row root gets `key: s.k` after prop spreads, so the resolved synthetic or explicit row key wins over any key in a spread; nested loops take the
enclosing row as owner and name scopes `s1`, `s2`, …; `Class.__roots = […]` is stamped
when any site has a root mask, capped at 31 (JS bitwise AND is 32-bit signed), past which
a site degrades to `volatile`.

- **Not lowered, nor anything nested inside:** `<Snippet>` bodies (stamped per
  expansion), range bodies, and `.map` fallbacks — tracked as `mapDepth`. A non-lowered
  body is emitted once and evaluated per iteration, so a block or cache slot inside it
  would be shared by every iteration.
- **Row facts** (`exprFacts`, absorbed into every enclosing site): a record local is on
  identity only as `todo.field` (joins `fields`) or the whole value; a deeper path,
  computed member, method call or any other whole-value use (function argument, operand,
  array/object element) marks `deep`; a clock function marks `volatile`. Facts are never
  collected during look-ahead passes.
- A read of an ENCLOSING site's loop local marks the reading site and every site between
  it and the owner `volatile`. Handler arguments add no row facts beyond data roots
  (re-read at fire time).
- An authored binding spelled like a row scope (`s`, `s1`, …) that would stay bare inside
  a lowered body is mangled to `__pzl<name>`. `s` itself never moves — it is the byte
  contract in the todos fixtures.

## Static subtrees and handler caching (`staticcache.go`)

Maximal static subtrees of ≥3 vnodes emit `(this.__c[n] ??= new ViewNode(…))` (or
`s.c[n]` in a row). A STATIC `island` children array is cached at any size (D44 never
patches it); a dynamic seed is not, since D44 re-seeds on remount. Excluded: nested
subtrees of a cached one, snippet bodies, `mapDepth` bodies, subtrees holding controlled
`value`/`checked`, and the render root. The `??=` prefix counts toward `startCol` in the
`attrsMultiline` width decision.

Handler caching ([[DECISION-D62-HANDLER-CACHING]]): arguments are lowered into a scratch
fact set (binding reads, data roots, library calls); `cacheable` = none →
`this.__h`; `rowCacheable` = binding reads of the lowered loop only →
`(s.h<n> ??= …)`, reading the row's current item at fire time. Range-var or snippet-param
captures stay fresh; a handler-valued conditional is never cached. Modifiers stay in the
attribute name for the ViewManager.

## Two-way binding, conditional arity, inline SVG, scoped CSS

- **Binding** ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]], `binding.go`):
  `classifyBindExpr` accepts an `Identifier` or a non-computed, non-optional `Member` on
  one (a bare loop variable never; a loop-var-rooted path yes); `detectAutoBind` applies
  the element conditions. Emitted as `'@<event>:bind': this.__bind(target, field, spec)`;
  it consumes no `__h` index (`attrKV` runs twice per attr). A member-path target is
  `root ?? 0` — `null` is reserved for the bare-local form. Attr names match
  case-sensitively (`VALUE=` stays one-way).
- **Conditional arity**: `if`/`unless`/`case` branches are padded with `ViewNode('#')`
  to the max static count only when every branch is stable; an item loop, a range body
  with an explicit `key`, or a slot marker makes the whole conditional unpadded.
- **Inline SVG**: reads one asset, validates a literal root, emits an island vnode, and
  registers the file as a watch input. Root attrs are literals: reserved names (`ref`,
  `island`, `key`, `flip`) dropped, `@@name` escapes decoded. Scans are memoized in the
  build-scoped `SVGCache` (shared with the plugin's shared-asset loader); the scan runs
  even in dedup mode (validity is defined by it), and hands out a COPY of the attr slice
  since `forBody` rewrites `key`.
- **Scoped CSS**: `ScopedCSS(filename, styles)` owns the D59 `@scope ([data-<id>])`
  wrapper next to `ScopeID`; the esbuild plugin and the playground WASM compiler both call
  it, so they cannot drift.

## Tests

Golden tests byte-compare fixtures and the canonical todos output (the byte contract the
emitter matches) and `node --check` emitted JS. Focused suites sit beside each file:
`expr_test`, `presets_test`, `markup*_test`, `row_facts_test`, `handler_cache_test`,
`listblock_test`, `static_cache_test`, `conditional_arity_test`, `core_semantics_test`,
`classname_test`, `scriptcollide_test`, `text_run_space_test`; the check emitter's tests
live in `compiler/internal/check`.
