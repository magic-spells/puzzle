# Implicit two-way binding on form elements — D147 / v1.68

Research + design record. Target release: **0.5.0**, alongside D144/D145/D146.

---

## 1. Why this exists

Puzzle has no two-way binding today. `value={ x }` is a one-way *controlled
property* — the DOM property is re-asserted from state on every patch — and the
author must hand-write `@input={ handler(event) }` to write back.

This went unnoticed because **the documentation already claims otherwise, in
three places, one of which is the compiler source**:

| Location | Text |
|---|---|
| `constellation/doc/DOC-SPEC-TEMPLATE.md:87` | "**Bindings:** `value={ var }` (**two-way on inputs**), `checked={ expr }`, …" |
| `constellation/doc/DOC-TEMPLATE-SYNTAX.md:506` | cheat-sheet row `\| Two-way input \| value={ var } \| value={ newTodoText } \|` |
| `compiler/internal/parser/ast.go:176-177` | "This covers dynamic attributes **and two-way bindings alike** (`value={var}`)" |

`constellation/doc/DOC-GLOSSARY.md:33` states the opposite and is the one that
is correct today:

> **controlled property** — … Puzzle does not infer a two-way state assignment;
> event handlers update state.

`examples/binding/package.json` describes a one-way demo as a "Two-way binding
demo", and `examples/binding/app/routes.js` sets `meta.title` to "Two-way
binding demo".

This is a documentation defect that produced a wrong mental model in the
framework's own author. **The decision is to make the documentation true rather
than retreat to it.**

---

## 2. The decision

`value={ path }` on a form element becomes genuinely two-way, **with no
keyword** — the Ember-classic `{{input value=name}}` shape.

Three sub-decisions, made explicitly:

1. **No keyword.** Not `bind:value=`, not a bare `bind`/`sync` marker.
2. **Local-state binds always `refresh()`** after `setData` — correct by
   default, closing the D23 papercut for bound values.
3. **Ships in 0.5.0.**

### Prior art surveyed

- **Ember classic** — `{{input value=name}}` was keyword-free and genuinely
  two-way. This is the shape being adopted.
- **Ember Octane** — removed implicit two-way as the default (Data Down, Actions
  Up) and kept it only in a built-in component: `<Input @value={{this.name}} />`.
  Rejected here: Puzzle has **no spread-props grammar**, so a reserved `<Input>`
  could not forward arbitrary attributes (`type`, `class`, `placeholder`,
  `@keydown:enter`) to the underlying element without new compiler machinery.
  A capitalized `<Input>` vs lowercase `<input>` differing only by case is also
  a legibility trap that D134 deliberately designed *against*.
- **Vue** `v-model`, **Svelte** `bind:value`, **Angular** `[(ngModel)]` — all
  require a directive namespace. See §3.

---

## 3. Why keyword-free also dodges a recorded conflict

`constellation/decision/DECISION-D85-FLIP-ATTRIBUTE.md:47-58`:

> **A directive ATTRIBUTE, not a directive NAMESPACE.** The prompting proposal
> wanted Svelte-shaped `animate:flip` syntax — a new template grammar family
> that ripples through the parser, codegen, goldens, three editor grammars, and
> the eslint/prettier plugins that vendor the section splitter. A plain `flip`
> attribute parses TODAY … **Rejected:** `animate:flip`.

A `bind:value` prefix would have re-litigated that card, and under CLAUDE.md's
one-decision-one-card rule D85 would have needed rewriting in place. Keyword-free
adds no namespace, so **D85 stands untouched**.

Corroborating posture at `constellation/doc/DOC-SPEC.md:128` (element actions
`use:name`, deferred):

> If real pressure appears, the intended shape is dynamic function refs
> (`ref={ expr }` …), **not a new directive namespace**.

`constellation/plan.md:202` already listed "two-way `bind` sugar plus a
schema-derived forms helper" under *identified and not scheduled*.

---

## 4. Design

### 4.1 Trigger conditions — all statically decidable, all must hold

The compiler auto-binds a `DynamicAttr` named `value` or `checked` when:

1. The tag is `<input>`, `<textarea>`, or `<select>` — a DOM element, never a
   component (components use callback props, D16).
2. The expression is a **plain property path**: `ident`, `ident.ident(.ident)*`,
   optionally leading `this.`. No calls, operators, brackets, `?.`, or formatter
   chains (`|`).
3. The element has **no author-written `@input` or `@change`** (with any
   modifiers). The author owning either event means the author owns the write.
4. No static `readonly` or `disabled` attribute — the explicit opt-out.
5. `type` is absent or **statically** known. A dynamic `type={ kind }` does not
   bind, because neither the event nor the coercion can be chosen.
6. Excluded types: `file`, `radio`, `submit`, `button`, `reset`, `image`,
   `hidden`. Excluded shape: `<select multiple>`.

Anything failing a condition compiles **exactly as it does today**. This is what
keeps every existing handler-paired input byte-identical.

**Accepted cost of the keyword-free choice:** `value={ draft }` binds but
`value={ draft || '' }` silently does not. Same-looking code, different behavior,
no error. This was chosen knowingly over a marker word.

### 4.2 Type-directed defaults — these replace a modifier channel entirely

| element / type | event | read | coerce |
|---|---|---|---|
| text/search/email/url/tel/password, `<textarea>` | `input` | `.value` | — |
| `type="number"` | `change` | `.value` | `Number` |
| `type="range"` | `input` | `.value` | `Number` |
| `type="checkbox"` (on `checked=`) | `change` | `.checked` | Boolean |
| `type="color"` | `input` | `.value` | — |
| date / time / month / week / datetime-local | `change` | `.value` | — |
| `<select>` (single) | `change` | `.value` | — |

These are not invented. They reproduce what the example apps already chose by
hand:

- `examples/canvas/app/components/Inspector.pzl:173-174` — comment: *"Sliders
  write on `@input` (continuous); number fields on `@change` (commit)."*
- `examples/orrery/app/components/BodyRow.pzl:92-96` — hand-written
  `Number(event.target.value)` on `distance`/`size`/`speed`.
- `examples/binding/app/views/Home.pzl` — `updateNumber` with the comment
  *"Range / number inputs hand back strings — coerce so the field stays a real
  number in the datastore."*

Because the defaults cover the real cases, **no modifiers are needed in v1** —
which is most of what a `bind:value:number:lazy` namespace would have bought.

### 4.3 Emitted JS

```js
// <input type="text" value={ draft } />
{ type: 'text',
  value: __d.draft,
  '@input:bind': this.__bind(null, 'draft', 'v') }

// {#for el in elements} <input type="number" value={ el.w } />
{ type: 'number',
  value: el.w,
  '@change:bind': this.__bind(el, 'w', 'vn') }

// <input type="checkbox" checked={ todo.completed } />
{ type: 'checkbox',
  checked: todo.completed,
  '@change:bind': this.__bind(todo, 'completed', 'c') }

// <select value={ sort }> … </select>
{ value: __d.sort,
  '@change:bind': this.__bind(null, 'sort', 'v') }
```

- `null` target ⇒ local state.
- Spec codes: `v` = value/string, `vn` = value/number, `c` = checked.
- The listener key carries `:bind` so it occupies a distinct `LISTENERS` slot
  (`viewManager.js:1364` keys by the **full modified name**) and is greppable in
  DevTools. `withModifiers` (`viewManager.js:1513-1531`) passes an unrecognized
  `bind` modifier through untouched — **verified, no runtime change needed**.

### 4.4 `__bind` — memoized, following the `__ref` precedent

`client-runtime/views/PuzzleView.js:275-290` (`__ref`) exists precisely because
the differ must see the *same* attrs value across renders — a fresh closure
churns every patch. Reuse the pattern:

- local arm → a `Map` keyed by `key + spec`
- object arms → a `WeakMap` keyed on the target object → inner `Map`

A stable function means `patchAttrs`'s `oldAttrs[name] !== value` is false, so
`setAttr` never re-runs. **This is what makes loop-scoped binding affordable** —
without it, every `{#for}` row would detach + `addEventListener` on every
keystroke.

> This was the decisive engineering point. The alternative design (emit a path
> *string* like `this.__bind('profile.displayName', event)` so the handler stays
> cacheable under `expr.go:592`) cannot express a loop variable, because `todo`
> is an arrow parameter and not reachable from `__d`. The `__ref`-style memo
> handles both.

### 4.5 Write dispatch — three arms

```js
#bindWrite(target, key, value) {
  if (target == null) {
    this.setData(key, value);
    this.refresh();                       // decided default (§2.2)
  } else if (typeof target.update === 'function' && typeof target._type === 'string') {
    try { target.update({ [key]: value }); }   // store rAF flush drives re-render
    catch (err) { reportError(this.ctx, err, { phase: 'bind', view: this, route: this.route }, …); }
  } else {
    target[key] = value;                  // plain object
    this.refresh();
  }
}
```

Record detection is **duck-typed** (`update` + `_type`) so `PuzzleView.js` never
imports `model.js`.

---

## 5. The five hazards, verified and resolved

### 5.1 Caret

The **only** caret preservation in the framework is emergent, at
`client-runtime/views/viewManager.js:1114-1116`:

```js
if (name === 'value' && (el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA')) {
  if (el.value !== stringify(value)) setAttr(el, name, value, owner);
}
```

There is **no** `selectionStart` / `setSelectionRange` / `isComposing` /
`compositionstart` / `document.activeElement` anywhere in `client-runtime/`
(grep-verified; also documented at `examples/stress/README.md:1056-1063`).

Uncoerced string binds round-trip byte-identically → the compare is false →
`el.value = …` never executes → caret untouched. **Coercion breaks this**:
`'1.20'` → `Number` → `1.2` → `'1.2'` differs → the write fires → caret jumps to
the end. That is why `type="number"` commits on `change`.

> Worth stating plainly, because it came up: re-running `data()` per keystroke
> does **not** touch the DOM in the round-trip-identical case. What still runs is
> the JS — `data()` re-executes (including every store query and its tracking
> re-subscription), the entire vnode tree is rebuilt, and `patchChildren` walks
> it diffing. The DOM comes out clean. That is the same cost any store change
> already incurs, which is what makes "always refresh" affordable — but it is not
> free. And the DOM *should* change in the motivating case: a search box narrows
> its list while the input itself round-trips to a no-op.

### 5.2 Numeric edge cases

- **`Number('')` is `0`** and would rewrite a field the user just cleared to the
  literal `"0"`, jumping the caret. **Fix:** write `null` instead —
  `displayValue(null)` returns `''` (`client-runtime/display.js:29`), so the
  compare is `'' === ''` and nothing is written.
- **`Number('-')` is `NaN`**, which **passes** `checkBound`'s gate — the comment
  at `client-runtime/model.js:206` reads *"a NaN-ish comparison is a pass, never
  a throw (§20)"* — so `NaN` would be written into the record and
  `displayValue` would render the literal text `"NaN"`. **Fix:** skip the write
  when `Number.isNaN(v)`.

### 5.3 Model validation throws

Both verified by reading `client-runtime/model.js`:

- **`required()` rejects a cleared field.** `model.js:147` —
  `const missing = value === undefined || value === null || value === '';` and
  `:163` — `if (def.required && missing && !autoGeneratablePrimary)` → error.
- **A string into a `number()` field with a min/max rule is rejected.**
  `model.js:220-222` in `checkBound`. Its doc comment already anticipates this
  exact scenario:

  > Type-aware (…§20): a field DECLARED number/date measures the VALUE, so **a
  > form-bound string like `"150"` must NOT satisfy `number().max(120)`** by its
  > 3-char length…

  The model layer already decided to fight form binding. Type-directed `Number()`
  coercion eliminates this case entirely.

`record.update()` (`model.js:544-576`) validates the patched keys and **throws
`PuzzleValidationError` before mutating**, so a rejected write leaves the record
untouched. There is **no type coercion anywhere** (`model.js:140-143`).

**Resolution:** catch, route to `reportError(..., { phase: 'bind' })` through the
D145 `onError` funnel. State unchanged ⇒ no render ⇒ no re-assert of `.value` ⇒
the user's typed text stays on screen. Add `'bind'` to the
`PuzzleErrorInfo['phase']` union in `types/index.d.ts:117-127`.

**Documented limit:** a `required()` field cannot be cleared through an implicit
bind. This is the model layer's stated contract, not something to engineer away.

### 5.4 IME / composition

No `isComposing` guard exists anywhere in `client-runtime/`. An app author
already had to reach for one: `examples/grimoire/app/views/Doc.pzl:475` —
`if (event.isComposing) return;`.

Once the framework owns the listener, it owns this problem. During CJK/accent
composition each `input` event delivers a partial buffer; if any transform makes
the value differ from the live property, `el.value = …` fires **mid-composition**
and Chrome/Safari abort the IME session, dropping characters.

**Fix:** `if (event.isComposing) return;` at the top of the bind handler. The
final `input` after `compositionend` carries `isComposing: false`, so the value
still lands. **Must be verified in a real browser**; add a `compositionend`
fallback listener only if Safari gaps.

### 5.5 Layer clobber

`client-runtime/views/PuzzleView.js` state layers:

```js
#data = {};    // composed, VISIBLE state — what render() sees
#local = {};   // setData() writes (+ created()-seeded state)
#model = {};   // last SUCCESSFUL data() result — REPLACED wholesale per commit
```

`#recompose()` (`:1529-1535`) composes `{ ...this.#local, ...this.#model }` —
**model spread LAST**. So a `setData` write for a key `data()` also returns is
discarded on the next commit, which can be triggered by any unrelated store flush
anywhere in the app.

`getData()` (`:151-153`) returns `{ ...this.#data }` — **a fresh shallow copy per
call**. This is why the naive Vue-style lowering (`__d.x = event.target.value`)
is a silent no-op and was never on the table: `__d` is a throwaway.

**The naive diagnostic is wrong.** Checking `key in #model` at write time
false-positives on the *correct* idiom — `examples/static-docs/app/views/Playground.pzl:46`
does `data() { const text = this.getData().text; return { text, … } }`, reading
its own local write back out.

**Use a post-commit check:** record `{ key → writtenValue }` at bind-write time;
on the next `#recompose`, if `#data[key]` differs from what was written and no
later bind superseded it, warn once per key. Dev-only, gated **inline** on
`__PUZZLE_DEV__` — never a hoisted `const DEV`, per the comment at
`PuzzleView.js:40-46` (a shared const defeats esbuild's per-site constant
folding).

**Documented rule: bind the source, not the derivation.** A path into a store
record (`profile.displayName`) writes where `data()` reads it and cannot clobber.

---

## 6. Verified facts worth keeping

Established during research; each confirmed by reading the file.

**Compiler**
- `parser/lexer.go:452-454` — `isNameChar` already permits `:` and `.`, so
  `bind:value` lexes today as one `TokAttrName`. `isNameStart` (:449) is
  `[a-zA-Z_]`, so a bare `:value` prefix is **not** lexable.
- `parser/parser.go:481-521` `buildAttr` is the **sole** attribute classifier and
  the only prefix dispatch is `strings.HasPrefix(name, "@")`. Consequence:
  **`bind:value={x}` compiles silently today** into a literal dead DOM attribute.
- AST attr kinds (`parser/ast.go:159-236`): `StaticAttr`, `DynamicAttr`,
  `EventAttr`, `MixedAttr`. `key`/`ref`/`island`/`flip`/`slot` are **not**
  separate kinds — just names checked in later passes.
- `codegen/codegen.go:302-314` emits `const __d = this.getData();` once per
  `render()`. `codegen/expr.go:258-273` rewrites every bare identifier to
  `__d.<name>` unless it is a `{#for}` loop var, `event`, a JS keyword/global, or
  preceded by `.`. **There is one flat scope object; `data()`-sourced, local, and
  prop values are indistinguishable at compile time.**
- `codegen/expr.go:592` — a handler is cacheable only when it references neither
  loop scope nor `__d.`; otherwise a fresh arrow per render → listener churn.
- `codegen/codegen.go:1130-1132` — **any `DynamicAttr` whose expression starts
  with `{` is a compile error.** So `flip={ opts }` is *not* precedent for an
  inline options object; `DOC-SPEC-VIEW.md:217` says the options object must be
  built in `data()` or script scope.
- **`attrKV` is called TWICE per attribute** — a width trial with `emit=false`
  (`codegen.go:1058-1075`) then the real pass with `emit=true` (:1084, :1093).
  Anything consuming a counter must gate on `emit` or handler indices drift and
  every golden churns.
- Dangerous type-switch sites for any new attr kind:
  `parser/island.go:180-207` (`attrNameOf`/`attrPos` **silently return `""` and a
  zero Position** for an unknown kind) and `parser/slot.go:73-91` (**no
  `default:` arm**).

**Runtime**
- `viewManager.js:32` — `PROPS = Set(['value','checked','disabled','selected','muted'])`,
  applied as DOM properties in `setAttr` (:1398-1410).
- `viewManager.js:1364` — the `LISTENERS` Symbol map keys by the **full modified
  name**, so `'@input'` and `'@input:bind'` are distinct slots and both would
  attach to the same native event, firing in attrs insertion order.
- `viewManager.js:1350` / `:1435` — the framework-directive strip list is
  `key`, `island`, `ref`, `flip`.
- `reassertSelectValue` (`viewManager.js:876-893`) fires on **both** mount (:599)
  and patch (:872), so `<select>` needs zero new runtime work.
- Store notifications are **rAF-batched** (`datastore/store.js:1124-1135`), so a
  record-backed bind costs one full `data()` + render one frame later.
- **There is no `store.update()`.** The single-record write API is
  `record.update(patch)` (`model.js:544-576`).
- The only runtime caller of `setData()` today is `devstate.js:312` (dev HMR
  state restore).

**Corpus**
- ~28 `value={ record.field }` (dotted path) vs ~17 `value={ bareIdent }` across
  the examples — **the dominant real shape is a store-record write**, which is
  why the three-arm dispatch matters and a local-only design would miss the
  majority.
- Handler shapes that will **not** reduce to an implicit bind and must keep their
  `@input`: clamping (`examples/canvas/app/components/Inspector.pzl:195-209`,
  `Math.max(8, Number(v) || 8)`), nullish massaging
  (`examples/stress/app/scenarios/FormState.pzl:305-306`), multi-field writes off
  `event.currentTarget` (`examples/grimoire/app/views/Doc.pzl:470-473`), and
  non-state method calls (`examples/music/app/components/MiniPlayer.pzl:98`,
  `this._player()?.setVolume(...)`).
- No debouncing anywhere in the examples.

---

## 7. Alternatives rejected

| Alternative | Why rejected |
|---|---|
| `bind:value={ x }` (Svelte) | Re-litigates D85's explicit "**Rejected:** `animate:flip`". Needs a new parser dispatch, modifier table, and namespace validation, plus new rules in 3 editor grammar repos or it renders colorless. |
| Bare `bind` / `sync` marker | Zero grammar cost and internally consistent with `island`/`flip`/`ref`, but still a word to learn, and it does not make the existing docs true. |
| `bind={ { number: true } }` options object | **Compile error** — `codegen.go:1130` rejects any expression starting with `{`. |
| Ember-Octane `<Input @value=…>` component | No spread-props grammar to forward `type`/`class`/`placeholder`/`@keydown` to the real element. `<Input>` vs `<input>` differing only by case is the trap D134 designed against. |
| Runtime `bindValue(path, event)` helper | ~30 lines, zero compiler change — but the author still writes the handler, so it barely improves on today's idiom and does not make the docs true. |
| Assigning to `__d` (Vue-style lowering) | Silent no-op: `getData()` returns a fresh shallow copy (`PuzzleView.js:151-153`). |
| Making `setData` always re-run `data()` | Framework-wide semantics change; D23's whole point is that it does not. |

**Scope line, to be stated explicitly in the D147 card:** no radio groups /
`bind:group`, no `<select multiple>`, no file inputs, no contenteditable
(already rejected twice — `DECISION-D44-DOM-ISLANDS.md:63`,
`DOC-SPEC-TEMPLATE.md:120`), no components (D16 callback props), no validation
display, no dirty tracking, no debounce.

---

## 8. File-by-file work

### Compiler — `compiler/internal/`

- **new `codegen/autobind.go`** — `lowerAutoBinds(tag string, attrs []parser.Attr)
  []parser.Attr`. Needs the whole attr slice (conditions 3–6 are sibling-aware),
  so it **cannot** live in `attrKV`, which sees one attribute. Must return the
  **same slice header** when nothing binds, so untouched templates emit
  byte-identically.
- `codegen/codegen.go` — call it as the first statement of **both**
  `attrsMultiline` (:1058) and `emitAttrs` (:1079), *not* the `emitElement`
  funnel, because `inlinesvg.go:185/189` calls the pair directly. Add an `attrKV`
  arm for the synthesized write attr. **It must consume no `c.handlerSites`
  index** — the `__bind` memo is per-instance, not per-site — or the width trial
  and the real pass diverge and all 28 goldens churn.
- **new reserved-namespace compile error** in `buildAttr`
  (`parser/parser.go:481-521`): a positioned error for any non-`@` attribute name
  containing `:`. Closes today's silent `bind:value` dead-attribute hole and
  reinforces D85. **Ship this regardless of the rest — ~6 lines.**
- `parser/ast.go:176-177` — fix the false docstring.
- Add cases at `parser/island.go:180-207` and `parser/slot.go:73-91` if a new
  attr kind is introduced (see §6 — these fail silently).

### Runtime — `client-runtime/`

- `views/PuzzleView.js` — `__bind()` next to `__ref` (:275-290), the three-arm
  write, the memo caches, the post-commit clobber diagnostic.
- `views/viewManager.js` — **no changes.** Verified: `PROPS` covers
  value/checked, `patchAttrs` does the caret-preserving live compare,
  `withModifiers` passes `bind` through, `reassertSelectValue` covers `<select>`
  on both mount and patch.
- `types/index.d.ts:117-127` — add the `'bind'` error phase.

### Examples

- `examples/binding/app/views/Home.pzl` — **the acceptance case.** It is
  literally the "Two-way binding demo", is not test-bound, and its entire
  `events` block collapses. `profile.hue` is a `Puzzle.number()` field, so it
  exercises coercion.
- `examples/stress/app/scenarios/FormState.pzl:61-71` — a deliberate no-handler
  controlled-render benchmark (`value={ row.text }`, `value={ row.choice }` with
  no handler) that would now auto-bind. Add `readonly` to preserve the
  benchmark's meaning and note it in the stress README.
- **Do not touch `examples/todos`.** `tests/fixtures/todos/{Home,Default}.compiled.js`
  are hand-maintained and **not** regenerable by `-update`
  (`golden_test.go:168-191`), and the example is additionally pinned by
  `parser/integration_test.go:44/155/226` and `build_test.go:39`. Its inputs are
  handler-paired so they do not auto-bind anyway.

### Docs and cards

- Rewrite the three false claims (§1) to state the real boundary: path-shaped
  expression, no author handler, statically-known type.
- `DOC-GLOSSARY.md:33` "controlled property" — a **changed decision**, so per
  CLAUDE.md **rewrite in place**; do not add a superseding card.
- New `constellation/decision/DECISION-D147-IMPLICIT-TWO-WAY-BINDING.md` with the
  §7 alternatives and the scope line. **Next free decision number is D147**
  (highest allocated is D146; unused gaps exist at D101–D109, D123, D124, D129).
- Product line **v1.68** (current line runs through v1.67).
- `constellation/plan.md:202` — move "two-way `bind` sugar" from *identified and
  not scheduled* to shipped.
- `constellation/doc/DOC-RELEASE-SURFACE.md` + the CLAUDE.md release block.
- `skills/puzzle/SKILL.md` is `go:embed`-ed into the binary — it **must** land in
  the same release or agents will emit stale guidance.
- `README.md:201-202` and `:396-402` show the one-way idiom.

### Downstream mirrors

**Nothing to do.** No new attribute syntax exists to highlight. `puzzle-eslint`
and `puzzle-prettier` only vendor section splitters and never parse attribute
names. This is a direct benefit of the keyword-free choice — a `bind:` prefix
would have needed new rules in `puzzle-vscode`, `puzzle-sublime`, and
`puzzle-zed` or it would have rendered as a colorless plain attribute
(`puzzle-vscode/syntaxes/puzzle.tmLanguage.json:370` already matches it as one).

---

## 9. Verification

```bash
npx vitest run
cd compiler && go test ./...
npm run test:types
```

Targeted:

- `go test ./internal/codegen -update` — expect **+1 golden pair, 0 modified**.
  Any modification to an existing golden means `lowerAutoBinds` is not returning
  the input slice header, or the write attr consumed a `__h` index.
- New Go test asserting `__h` indices run `0..n` with no gap on a template mixing
  an auto-bind with several cached `@event` handlers — the width-trial canary.
- New vitest suite: each of the three write arms; `checked` read off a checkbox;
  `<select>` on `change`; `''` → `null` → no DOM write; `NaN` skipped;
  `update()` throws → `onError` fires with `phase: 'bind'`, state unchanged, DOM
  text preserved; clobber warning fires once and dev-only; setter identity stable
  across renders (no listener churn); an author `@input` suppresses binding.
- **Caret test in a real browser, not jsdom** — type mid-string into a bound text
  input, force a patch, assert `selectionStart` is unmoved. jsdom does not model
  number-input value sanitization faithfully.
- **IME test in a real browser** — compose Japanese into a bound input, assert no
  characters are dropped.
- `cd examples/binding && npm run build`, then drive it in Chrome: every input
  round-trips, the JSON proof panel tracks, and the paired hue slider/number stay
  in lockstep.

---

## 10. Execution

Estimate **≈4–5 engineer-days** including tests, cards, and browser verification.

Suggested split into three independently verifiable slices, delegated to
background agents and reviewed as diffs:

1. The reserved-namespace compile error + the three doc corrections. Standalone,
   shippable on its own merit.
2. `lowerAutoBinds` + type-directed defaults + goldens.
3. `__bind` + the three-arm write + runtime tests + the clobber diagnostic.
