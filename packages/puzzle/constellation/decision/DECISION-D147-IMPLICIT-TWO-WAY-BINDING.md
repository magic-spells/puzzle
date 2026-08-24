---
name: D147 — implicit two-way form binding
status: verified
connections:
  - DECISION-D04-EVENT-HANDLER-CONVENTION
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D23-REFRESH-PATTERN
  - DECISION-D38-EVENT-MODIFIERS
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D85-FLIP-ATTRIBUTE
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D133-RESERVED-SCRIPT-BINDINGS
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - FLOW-REACTIVITY
  - DOC-SPEC-TEMPLATE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Verified against the implemented branch: classifier/synthesis (binding.go, both emitters),
      runtime __bind/#bindWrite with the primitive-target inert-handler guard, suppression/goldens
      byte-exact, real-Chrome pass (caret, IME composition events, number-on-change, ''→null,
      range). Final whole-branch review + scoped re-review clean.
    sha: 770ef49d53752b85892311f5d2a82e2bf19fd39c
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/viewManager.js
---

# D147 — implicit two-way form binding

## Context

`value={ draft }` reads state into a form control, but nothing carries the
user's edit back — every bound field needs a one-line `@input` handler whose
body is always the same write. That mirror handler is the most repeated glue in
Puzzle apps. Other frameworks solve it with directive syntax (`bind:value`,
`v-model`), but Puzzle's grammar deliberately has no attribute namespaces
([[DECISION-D85-FLIP-ATTRIBUTE]] rejected the directive namespace;
[[DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS]] rejects case-only-difference
markers), and `.pzl` scripts are opaque bytes to Go (D03) — so any solution must
be statically decidable from the template alone.

## Decision

The compiler synthesizes the write-back handler. Zero new syntax; a narrow
lexical classifier over the raw `DynamicAttr` expression plus element context
decides, and the runtime supplies one memoized dispatcher. `viewManager.js` is
untouched — controlled props, the caret-safe live-DOM echo guard, modifier
passthrough, and `reassertSelectValue` already carry it.

### Trigger conditions — all statically decidable, ALL must hold

A `DynamicAttr` named `value` or `checked` auto-binds when:

1. The tag is a plain `<input>`, `<textarea>`, or `<select>` — never a component
   (component `value` is a plain prop; [[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]
   stands).
2. The expression is exactly `ident` or `ident.ident` (whitespace-trimmed). No
   calls, operators, brackets, `?.`, ternaries, formatter pipes, deeper chains
   (`a.b.c` — a nested plain object under a record would silently miss store
   notification), or `this.` prefixes. Roots in `jsKeywords`/`jsGlobals` never
   classify. A **bare** loop variable doesn't classify (nothing writable behind
   it); a loop variable as the **root of a member path** (`todo.completed`) does.
3. The element has **no author-written `@input` or `@change`** (any modifiers).
   Either one present = the author owns the write = no synthesis. Handlers on
   other events (`@keydown:enter`, `@blur`, …) do NOT suppress.
4. No static `readonly` or `disabled` attribute (the no-new-syntax opt-outs).
5. `type` is absent or a **static** string the matrix classifies. Dynamic
   `type={ … }` never binds. `checked` binds only with static `type="checkbox"`;
   `value` on a checkbox (the form submit-value) never binds. Excluded types:
   `file`, `radio`, `submit`, `button`, `reset`, `image`, `hidden`. Excluded
   shape: `<select multiple>`.

Anything failing a condition compiles **exactly as today** — silently (computed
value bindings are legitimate display cases; no warning spam). Accepted cost of
keyword-free: `value={ draft }` binds but `value={ draft || '' }` doesn't, with
no error. Chosen knowingly over a marker word. The three escapes are all
existing syntax: write your own handler, use a non-path expression, or add
static `readonly`.

### Element / event / coercion matrix

| Control | Event | Read | Write value | Spec code |
|---|---|---|---|---|
| `<input>` absent/text-ish type (text, search, email, password, url, tel, color) | `input` | `.value` | string | `v` |
| `<input type="number">` | `change` | `.value` | `'' → null`; `Number(v)`; skip write if NaN | `vn` |
| `<input type="range">` | `input` | `.value` | `Number(v)`; skip if NaN | `vn` |
| `<input type="checkbox">` (on `checked=`) | `change` | `.checked` | boolean | `c` |
| date / time / month / week / datetime-local | `change` | `.value` | string | `v` |
| `<textarea>` | `input` | `.value` | string | `v` |
| `<select>` (single) | `change` | `.value` | string | `v` |

Number commits on `change` because coercion breaks the caret-preserving
round-trip: `"1.20"` → `Number` → `1.2` → display `'1.2'` ≠ live `'1.20'` → the
patcher rewrites the input mid-typing, destroying the trailing `0`. Range has no
caret, so `input` is fine. Date/time kinds commit on `change` (partial segment
entry yields `''` on `input`). Numeric edges: `Number('')` is `0` — writing it
would rewrite a just-cleared field to `"0"` and jump the caret, so `''` writes
`null` (`displayValue(null)` → `''`, echo compare stays equal). `Number('-')` is
`NaN`, which passes model bound checks and would render literal `"NaN"` — NaN
writes are skipped.

### Emitted shape

The synthesized attr rides the existing modifier channel under a distinct
listener key — `'@input:bind'` / `'@change:bind'` — mapping to a **render-time
call** that returns a memoized handler:

```js
'@input:bind': this.__bind(null, 'draft', 'v')            // local state
'@change:bind': this.__bind(todo, 'completed', 'c')       // loop-var member path
'@change:bind': this.__bind(__d.profile, 'hue', 'vn')     // data-root member path
```

`null` target ⇒ local state (`setData` + `refresh`). Dotted path ⇒ target is the
resolved root, field the second segment. The synthesized attr consumes **no
`__h` handler-site index** ([[DECISION-D62-HANDLER-CACHING]] indices are
untouched — `attrKV` runs twice per attr, so a counter consumed there would
drift indices and churn every golden).

### Runtime dispatch

`PuzzleView.__bind(target, key, spec)` memoizes per (target, key, spec) — a Map
for locals, WeakMap-of-Maps for member targets — so `patchAttrs` sees a stable
function identity across renders and does not re-attach listeners
([[DECISION-D18-PER-NODE-LISTENERS]] economics preserved; a fresh arrow per
render would detach + re-add every `{#for}` row's listener on every store
flush). Stability is inherited from the TARGET: locals key on a string, and a
store record keeps one object identity across `update()`, flush, and repeated
`findOne` (D50), so both are stable by construction. A plain object that `data()`
rebuilds on every run is a WeakMap miss every render — the listener churns and,
more seriously, the write lands on the object the next commit discards. That is
the rebuilt-root hazard below, not a memo defect. The handler guards `event.isComposing` (a mid-composition write aborts
the IME session; the final post-`compositionend` input carries
`isComposing: false` so the value still lands), applies the matrix coercion,
then dispatches through a three-arm write:

- **Local** (`target == null`): `setData(key, value)` + `refresh()` — refresh,
  not bare setData, so a bound filter field feeding `data()`-derived values
  narrows its list as you type ([[DECISION-D23-REFRESH-PATTERN]]'s pairing,
  applied automatically).
- **Record** (duck-typed `update` + `_type` together — `PuzzleView.js` must not
  import `model.js`): strict `record.update({ [key]: value })`. Validation is
  never bypassed — a non-validating assign would let schema-invalid records
  into the store, undermining [[DECISION-D48-SCHEMA-VALIDATION]]'s guarantee
  for subscribers, adapters, and persistence. `update()` throws **before**
  mutating, so a rejected write changes nothing: no render, no re-assert, the
  typed text stays on screen. The `PuzzleValidationError` routes through the
  [[DECISION-D145-ERROR-BOUNDARIES]] funnel with `phase: 'bind'`.
- **Plain object**: `target[key] = value` + `refresh()`.

Documented limits that follow: a `required()` field cannot be *cleared* through
a bind, and constrained free-text fields (`min(3)`) should bind a **local
draft** and commit on submit — D48's non-throwing `record.validate()` is the
form-UX answer. No hidden dirty-state layer.

### Hazards resolved

1. **Caret** — emergent from the view manager's controlled-prop rule:
   `value`/`checked` compare against the live DOM property, so the
   per-keystroke echo writes nothing. Coercion breaks the round-trip → number
   commits on `change`.
2. **IME composition** — the `isComposing` guard above covers the WRITE side: no
   state write lands mid-composition, and the composed text arrives with the
   input that follows `compositionend`. The guard necessarily makes state lag the
   DOM for the duration of the composition, so a re-render driven by something
   else (a store flush, a sibling's `setData`) re-asserts the stale value into the
   composing element through the view manager's controlled-prop rule. Guarding the
   patch side too — skipping the live-DOM re-assert for an element that is
   mid-composition — is the remaining half.
3. **Validation throws** — strict update + `phase: 'bind'` report, state
   unchanged.
4. **Layer clobber** — `#recompose` composes model over local, so a `setData`
   write for a key `data()` also derives from a record/prop is reverted on the
   next commit. The compiler cannot detect it (`data()` is opaque bytes).
   Taught rule: **bind the path you want written** — `value={ profile.name }`
   for record forms, bare `value={ draft }` for local drafts. A dev-only
   diagnostic records bind-written locals and warns once per key when a
   recompose reverts one (a naive `key in model` check would false-positive on
   the legitimate read-own-write echo idiom).
5. **Islands** — a bind inside an [[DECISION-D44-DOM-ISLANDS]] subtree attaches
   at mount and survives the freeze; data flows out of the island, never into
   it. Documented, not special-cased.
6. **Rebuilt member root** — the plain-object arm writes to the object the
   template resolved, so that object has to survive the `data()` re-run the write
   triggers. `data() { return { form: { name: '' } } }` returns a NEW object every
   run: the write lands on the outgoing one, `#commit` replaces the model
   wholesale, and the controlled-prop compare rewrites the field — every keystroke
   erased, silently. Records and bare locals are stable by construction, so this
   is only reachable for plain objects. A dev-only diagnostic warns once per key,
   armed on the write and read at the END of the following render: it fires only
   when the written object never reappeared, exactly one replacement did, and that
   replacement did not carry the value. The completed-render fence is what keeps a
   `{#for}` from false-positiving when a sibling row is visited first, and record
   writes never arm it, so replacing a record stays silent. The fix in app code is
   a stable object (`this.memo(...)`), a record, or a bare local key.
7. **A failed `data()` after a bound write** — the write-back's own `refresh()` is
   a fire-and-forget call from a DOM listener, so both arms route a synchronous
   throw and an async rejection into the [[DECISION-D145-ERROR-BOUNDARIES]] funnel
   with `phase: 'bind'`. Left bare it escaped the event path entirely: no
   `onError`, no boundary, nothing logged — the one refresh site in the class that
   did not contain its own failure.

## Out of scope

Radio groups; `<select multiple>`; file inputs; `contenteditable` (D44's
rejection stands); component-prop binding (no `$bindable` analogue; D16
stands); paths deeper than one member (`a.b.c`, `items[i].text`); path-aware
`setData`; debounce/lazy modifiers; validation display / dirty tracking; the
schema-derived forms helper (bind is the substrate, forms are a later product
layer); explicit `bind:`/opt-out syntax (the three no-syntax escapes cover it).

## Alternatives rejected

- **`bind:value` / directive namespace** — re-litigates D85's namespace
  rejection and drags three editor grammars, the eslint/prettier ports, and the
  lexer with it. The namespace is now a positioned compile error reserving the
  space (non-XML `:` prefixes; `xml`/`xlink`/`xmlns` allowlisted for SVG). The
  check runs at the attribute NAME, before the `=` branch, so the valueless
  spelling `<input bind:value>` is rejected on the same footing as the valued
  one. Event attrs are exempt — they own the colon for their modifier channel.
  The error names the offending prefix and then splits on the name, because two
  unrelated authors land on it: a directive-shaped half (`bind`, `model`,
  `v-model`, `sync`, `value`, `checked`) means someone arrived from another
  framework and is taught the keyword-free form, while anything else is almost
  always pasted editor output (`inkscape:`, `sodipodi:`, `serif:`) and is pointed
  at `{#svg}`. One generic message necessarily misdirects whichever author it was
  not written for.
- **A bare `bind`/`sync` marker word** — new grammar for something the
  classifier can infer; every escape it enables already exists without it.
- **Options-object `bind={{ … }}`** — object literals in template expressions
  are a compile error today; would open the door D85 closed.
- **Ember-Octane-style `<Input>` component** — no spread-props to forward
  native attrs, and a framework component named like an element is D134's
  case-only-difference trap.
- **Runtime-only helper (no compiler change)** — the author still writes glue;
  misses the entire point.
- **Vue-style `__d.x = v` lowering** — `getData()` returns a copy; writes to it
  are lost. The write must dispatch through `setData`/`update`.
- **Both-run handler composition (author handler + auto-write)** — double-write
  hazards: a clamping author handler gets stomped by a raw re-write of the live
  value, and auto-first merging silently changes existing handler semantics.
  Suppression keeps every existing handler-paired template byte-identical and
  needs no capture-phase/microtask ordering guarantees.
- **Validation-bypassing record writes** — schema-invalid records visible to
  every subscriber; rejected outright.
- **Always-warn on non-classifying expressions** — warning spam on legitimate
  computed display bindings; silence is the correct default.

## Consequences

- A control carrying an author `@input`/`@change` compiles byte-identically;
  adopting the feature is *deleting* that mirror handler. The upgrade risk is the
  complement: a handler-less, path-shaped `value=`/`checked=` that was
  display-only — or one paired with a handler on some OTHER event — starts
  writing back. `@keydown:enter`/`@blur` edit buffers are the shape to look for;
  `examples/music` binds through `String(...)` for exactly that reason, since a
  live write would let Escape-to-cancel commit the text it exists to discard.
  Compile-and-grep for `__bind(` is the audit, not eyeballing templates.
- The `:bind` suffix is greppable and visible in DevTools listener listings.
- SSG/static serialization strips `@`-prefixed attrs already, so prerendered
  markup carries the controlled initial value and no bind artifacts; hybrid
  takeover and `mountStatic` attach the listener on mount.
- The docs, SKILL.md, and examples teach bind-the-source-path and the
  local-draft idiom for constrained fields.
