# Implicit two-way input binding — D147 plan

Written 2026-07-28 (Fable session "2-Way Fable"). Status: **planned, approved decisions
locked with Cory, not yet implemented**. Target: `release/0.5.0`.

The ask: `<input value={ newTodoText } />` should just two-way bind — typing writes back
to state automatically, with **no special syntax** (explicitly NOT `value:bind={...}` or
any `bind` keyword). Cory assumed this already worked; it never did — today it's one-way
controlled-property sync paired with a hand-written `@input` handler.

Decisions locked with Cory (via AskUserQuestion):

1. **Bind scope: locals AND record fields** — not just the safe setData-locals core.
2. **Auto-coerce numbers** for static `type="number"` / `type="range"` (Svelte-style).
3. **Land on `release/0.5.0`** (unpublished, binaries being rebuilt anyway).

---

## 1. Framework research (the "how do others do it" survey)

- **Ember classic** — `{{input value=name}}` was fully two-way (`Ember.TextField` +
  `Ember.Binding`). This is what Cory remembered. **Ember itself retreated** in Octane
  (3.15+, 2019) to "data down, actions up": `<input value={{this.name}} {{on "input"
  this.updateName}}>` — because two-way bindings crossed component boundaries and made
  data flow untraceable at app scale.
- **Svelte** (3/4/5) — explicit `bind:value={name}`. Svelte 5 runes kept `bind:` and added
  `$bindable` for component props. Mechanics worth copying: `input` event for text,
  `change` for checkbox/select, **automatic number coercion** for `type=number/range`
  (empty string → null-ish), no binding for `type=file` value.
- **Vue** — explicit `v-model` (desugars to `:value` + `@input` / `modelValue` +
  `update:modelValue`). Numbers are strings unless `.number` modifier.
- **Angular** — explicit `[(ngModel)]`. Alpine — explicit `x-model`. Knockout — explicit
  `data-bind`. **Nobody ships implicit two-way on a plain `value={x}` anymore.**

**Why implicit is still safe for Puzzle when it wasn't for Ember:** Puzzle template
expressions only ever see the view's OWN state (`__d` = the view's composed data, plus
loop variables). A binding can never silently mutate a parent component — the exact
failure mode that killed the pattern elsewhere is structurally impossible here. Component
tags (`<TextInput value={x}/>`) are excluded: `value` there is just a prop.

---

## 2. Current state of the repo (exploration findings, with file:line refs)

### 2.1 The SPEC already promises this feature

- `constellation/doc/DOC-SPEC-TEMPLATE.md:87` (§6 Template grammar): "**Bindings:**
  `value={ var }` **(two-way on inputs)**" — a long-standing misnomer for one-way
  controlled sync. Shipping real write-back makes §6 honest.
- The contradictions that must be fixed in the same change:
  - `constellation/doc/DOC-GLOSSARY.md:31-33` — "Puzzle does not infer a two-way state
    assignment; event handlers update state."
  - `constellation/doc/DOC-TEMPLATE-SYNTAX.md:257-259` — "Puzzle does not infer the
    write-back expression" (+ cheat-sheet row at `:506` which says "Two-way input").
- `constellation/plan.md:202` lists "two-way `bind` sugar plus a schema-derived forms
  helper" as identified-and-NOT-scheduled. Never rejected. Note: it says *`bind` sugar* —
  D147 deliberately ships the no-sugar inference instead; the card must record that
  divergence.
- `DECISION-D44-DOM-ISLANDS.md:63` rejected only the **contenteditable** analogue
  (`text=` two-way) — and justified the rejection by asserting `value=` works BECAUSE
  inputs hold a flat string the browser never restructures. Our feature makes that
  justification true. Bright line: inputs/textarea/select yes, contenteditable never.

### 2.2 Compiler (Go) — how `value={ x }` compiles today

- AST: `value={ expr }` is a `DynamicAttr{Name, Expr, Pos}` (`compiler/internal/parser/ast.go:179`)
  where `Expr` is a **raw unparsed JS string**. Classification is `buildAttr`
  (`parser.go:481-521`); only `@`-prefix gets special dispatch. `value`/`checked` get zero
  special treatment at parse time.
- Codegen: single choke point `attrKV` (`compiler/internal/codegen/codegen.go:1111-1173`).
  The DynamicAttr arm emits `value: __d.newTodoText` — a plain vnode attr key. See
  `codegen/testdata/boolean_attr.pzl` → `.golden.js`:
  ```js
  new ViewNode('input', { type: 'text', value: __d.name, autofocus: true }, []),
  ```
- Events: `EventAttr` arm at `codegen.go:1136-1169`. Emitted shapes:
  ```js
  '@click': ((this.__h ??= {})[0] ??= (event) => this.events.clear(event))  // cacheable (D62)
  '@click': (event) => this.events.open(item)                               // loop var → uncached
  ```
  Modifiers ride in the vnode KEY (`'@keydown:enter:prevent'`); runtime splits on `:`
  (`viewManager.js:1355`). Cacheability rule (`expr.go:592`):
  `cacheable := !referencesLoopScope && !strings.Contains(argsJS, "__d.")`.
- **Expression scoping** (`expr.go:130-326`, `resolveExpr`): byte-level tokenizer, NOT a JS
  parser (SPEC §6 "expression boundary" — contract, not a bug). Root identifiers not in
  loop `scope`/keywords/globals get prefixed `__d.`. The compiler knows loop variables
  (the `scope` map) but has NO idea whether `newTodoText` is a data() field, a prop echo,
  or a typo — data() is opaque script bytes. There is no lvalue concept anywhere; a new
  classifier is needed.
- **Synthesizing attrs the author didn't write is idiomatic** — two precedents:
  `forBody` injects a synthetic `key` DynamicAttr (`codegen.go:958-963`); scoped styles
  inject a `data-<scope>` StaticAttr (`codegen.go:194`).
- Landmines: `emitAttrs` (`codegen.go:1079-1104`) does NOT dedup keys — a synthesized
  `'@input'` colliding with an author's would silently last-win (avoided by the
  suppression rule below). `attrsMultiline` breaks to multi-line at ≥2 attrs → formatting
  churn. `this.__h` site indices are a per-file counter → consuming one renumbers every
  downstream handler → golden churn (acceptable per Cory's standing rule).
- Errors/warnings: fatal = `parser.ParseError` via `c.cgErr(pos, msg)` (`codegen.go:413`);
  non-fatal = `codegen.Warning` (out-of-band, goldens unaffected; a11y pass
  `a11y.go:36` is the model, incl. the "only act on statically-known `type`" rule).
- Goldens: `compiler/internal/codegen/testdata/*.pzl` + `.golden.js`, byte-compared by
  `golden_test.go:38-71`; regenerate with
  `go test ./compiler/internal/codegen -run TestGoldens -update`. Hand-written anchors:
  `TestGoldenHome` compiles `examples/todos/app/views/Home.pzl` against
  `tests/fixtures/todos/Home.compiled.js` (contains the literal
  `value={ newTodoText } @input={ updateNewTodoText(event) }` case); `TestGoldenDefault`;
  `TestNodeCheck` (`node --check`).

### 2.3 Runtime — the parts that make this feature nearly free

- `viewManager.js:32` — `PROPS = new Set(['value','checked','disabled','selected','muted'])`
  assigned as DOM **properties** (`setAttr:1398-1409`); `value` never mirrors to the HTML
  attribute.
- **The caret-preservation guarantee** (`viewManager.js:1099-1120`): `value` on
  INPUT/TEXTAREA and `checked` on INPUT are compared against the **live DOM property**,
  not the old vnode. The per-keystroke echo (bound value already equals the live
  property) **writes nothing** — caret and IME composition survive. Pinned by
  `tests/vdom.test.js:147-179` (spy on the HTMLInputElement `value` setter, asserts
  `writes === 0`). When values genuinely differ, the write lands and the caret collapses
  to end — that's the desired controlled-rejection behavior (`vdom.test.js:172`).
- `<select>` is special-cased via `reassertSelectValue` (`viewManager.js:879-893`, called
  after children mount/patch) because `value` is meaningless before options exist.
- There is NO focus/composition guard anywhere — and none is needed, precisely because of
  the live-compare echo skip.
- Listeners: per-node, keyed by full attr name incl. modifiers in `el[LISTENERS]`;
  attach/swap in `setAttr:1352-1395` (wrapped in `owner.__withCommittedScope` — D146);
  `patchAttrs` only re-calls setAttr when the handler identity changed — the D62 cache
  is what prevents re-attach churn.
- **State layering** (`PuzzleView.js:48-60, 150-175, 1529-1535`): `#data` (composed) =
  `{ ...#local, ...#model }`; `setData(key, value)` and `setData(patch)` both exist,
  write `#local` AND `#data`, schedule ONE coalesced rAF render, never re-run data();
  `data()` commit REPLACES `#model` wholesale; `#recompose` deletes keys absent from both
  layers; `#local` is sticky for the instance lifetime (no unsetData). Render reads
  ONLY `const __d = this.getData()` — props/params never merge in unless data() returns
  them.
- **The three-row layering table** (decides all binding semantics):
  | data() returns the bound key? | After next data() commit |
  |---|---|
  | No | local value survives indefinitely — durable |
  | Yes, echoing getData()/local | overlay no-op — durable (todos idiom) |
  | Yes, derived from store/props | **model wins → typed value reverted** (+ the stale write stomps the focused input) |
- Record writes: `record.update(patch)` (`model.js:544-576`) validates ONLY patched
  fields and **throws before assigning** on failure; primary-key patch throws;
  `safeAssignTracked` stamps a local-edit revision (D125, protects against in-flight
  save() responses clobbering typing); then `store.recordChanged(this)` → rAF-batched
  flush → `_deliverNotifications` → subscribed views `refresh()` → data() re-runs →
  commit → render. Writing `todo#3` also notifies whole-type subscribers (parent list
  re-renders per keystroke). Persistence is batched into flush deliberately ("too costly
  to run inline on every keystroke's update()" — store.js:1158-1166 comment).
- **Record-path caret timing is safe**: the mutation is synchronous; data() re-runs at
  flush time reading the same record, so the committed render always carries the input's
  current text → echo guard skips the write. No frame-behind stomp.
- Current form idioms in the repo:
  - `examples/todos/app/views/Home.pzl:5-12` — `value={ newTodoText }` +
    `@input={ updateNewTodoText(event) }` + `created()` seeding + data() echo. THE
    canonical manual pattern; also duplicated in
    `compiler/internal/scaffold/templates/todos/` (go:embed'd → binary rebuild needed).
  - `examples/binding/app/views/Home.pzl` — a whole example app of the manual
    record-round-trip pattern (text/range/number/color/textarea writing
    `record.update()` via handlers). Best regression target.
  - `examples/todos/app/components/TodoItem.pzl:5-9` — checkbox
    `checked={ todo.completed } @change={ toggle(event) }`.
  - `examples/chat/app/components/Composer.pzl:24-36` — the repo's only `<select>`.
  - `examples/canvas/app/components/Inspector.pzl:173-174` — "Sliders write on `@input`
    (continuous); number fields on `@change` (commit)" — the input-vs-change design input.
- Testing infra: `tests/helpers/todos-suite.js:85-95` typeAndSubmit pattern;
  `client-runtime/testing/` has `mountView`/`createTestApp`/`settled()` but **no type()
  helper yet**; `settled()` collapses the whole rAF/flush chain deterministically.

### 2.4 Identifiers / numbering

- Next free decision card: **D147** (D123/D124/D129 are gaps — never backfill).
- Next free SPEC section: **§57** (index in `DOC-SPEC.md` has 56 rows).
- Recent convention (D145/D146): cards stamped by release (`0.5.0` + `verified_sha`)
  rather than v1.NN. Follow that.

---

## 3. The design

### 3.1 What auto-binds — the compile-time classifier

New classifier over the raw `DynamicAttr.Expr` (compiler lexes, never parses JS).
Accepts exactly a **dotted identifier chain**: `ident(.ident)*` — no calls, indexing,
operators, `?.`, ternaries, template literals, formatter pipes. Roots in
`jsKeywords`/`jsGlobals` (`expr.go:19-46`) don't classify. Non-classifying expressions
keep today's one-way behavior **silently** (computed value bindings are legitimate
display cases — no warning spam).

Synthesis fires when ALL hold:

- plain element (never component tags), tag ∈ {`input`, `textarea`, `select`}
- bound attr is `value` (or `checked` for checkboxes) and its expr classifies
- the author wrote **no `@input` and no `@change`** on the element (modifiers included)
  — the suppression rule. Author handlers own write-back; every existing app keeps
  byte-identical semantics (todos, examples/binding, TodoItem, canvas all suppress).
  Handlers on OTHER events (`@keydown:enter` etc.) do NOT suppress.
- per-element rules below permit it

### 3.2 Per-element rules (only when `type` is a STATIC attr — a11y-pass rule: never guess runtime values)

| Element | Binds | Event | Write value |
|---|---|---|---|
| `<input>` absent/text-ish type (text, search, email, password, url, tel, color, date/time kinds) | `value` | `@input` | `event.target.value` |
| `<input type="number"\|"range">` | `value` | `@input` | `event.target.value === '' ? null : event.target.valueAsNumber` |
| `<input type="checkbox">` | `checked` | `@change` | `event.target.checked` |
| `<textarea>` | `value` | `@input` | string |
| `<select>` (no static `multiple`) | `value` | `@change` | string |
| `type="radio"`, `type="file"`, dynamic `type={...}`, `<select multiple>` | — no synthesis — | | |

`value={ x }` on a checkbox (the form submit-value) never synthesizes; only `checked`.

### 3.3 Write-back dispatch — two emitted shapes

**Bare identifier** → local state (`setData`), cacheable per D62 (no `__d.`/loop refs):

```js
'@input': ((this.__h ??= {})[N] ??= (event) => this.setData('newTodoText', event.target.value)),
```

**Dotted path** (`todo.text`, `profile.displayName`, `a.b.c`) → target = all-but-last
segment resolved normally (loop var stays bare, data root gets `__d.`), field = last
segment, dispatched through ONE small new runtime helper:

```js
'@input': (event) => this.__bindField(todo, 'text', event.target.value),          // loop var → uncached (D62)
'@input': (event) => this.__bindField(__d.profile, 'displayName', event.target.value),
```

`PuzzleView.prototype.__bindField(target, field, value)` (~15 lines):

- `target instanceof PuzzleModel` → assign via a **non-validating** tracked path (same
  internals `update()` uses: `safeAssignTracked` local-edit revision stamp per D125, then
  `store.recordChanged(record)`), **skipping schema validation**. Rationale:
  per-keystroke validation would throw on every partial keystroke of a `.min(n)` field
  and wedge the input (update() throws BEFORE assigning → next patch reverts the input →
  typing impossible). The framework's own form-UX answer is non-throwing
  `record.validate()` (D48) at submit time. Primary-key field: silently skip the write —
  never throw from a keystroke.
- plain object → `target[field] = value` + schedule a render (mutate-and-repaint; no
  store semantics). Predictable for local plain-object rows; model-layer caveat applies.
- Do NOT route through public `record.update()` (it validates and throws). Needs a
  package-internal assign helper exported from `model.js` next to update()'s internals,
  or a private method on `PuzzleModel`.

One shared helper instead of per-site inlined dispatch = fewer total emitted bytes
(Cory's compiler-over-runtime-bytes rule still favors this: per-site emit stays tiny).

### 3.4 The documented hazard (goes in the new SPEC §57 near-verbatim)

Auto-binding a **bare identifier** writes the LOCAL layer. If `data()` derives that key
from a record/prop each run, the next store-driven commit reverts the typed value
(two-layer precedence). The compiler cannot detect this. The taught idiom becomes:
**bind the path you want written** — `value={ profile.displayName }` (record
write-through) for record forms; bare `value={ draft }` for local drafts. Seed local
fields (`created()` + `setData`) so first render isn't `undefined` (dev warns via
`displayValue`).

Island interaction: binding inside an `island` subtree still writes state OUT (listener
attaches at mount and survives the freeze) — consistent with §17's "data flows out of an
island, never into it". Document, don't special-case.

---

## 4. Implementation map

### 4.1 Compiler (`compiler/internal/codegen/`)

1. **Classifier** — new func (in `expr.go` or a new `binding.go`):
   `bindablePath(expr string, scope map[string]bool) (target, field string, bare, ok bool)`,
   reusing `isIdentStart`/`isIdentChar` (`expr.go:57-63`). Runs on the RAW expr.
2. **Synthesis** — in `emitElement` (`codegen.go:510`) before `emitAttrs`: detect
   eligible element/attr/suppression, then append a synthetic `parser.EventAttr`
   (precedent: forBody's synthetic key, `codegen.go:958-963`) or emit the handler KV
   directly. Gate on `!isComponent`. Static-`type` lookup mirrors `a11y.go`.
3. **Handler emit** — bare-ident form uses the `this.__h` site cache
   (`c.handlerSites`); path form emits an uncached arrow (D62 rule).
4. Number coercion emitted inline per the table.
5. **No parser/lexer changes. No new grammar.** (Note: `value:bind` would already lex as
   one attr name if an opt-out is ever wanted — lexer.go:452-454 — but v1 has none;
   `readonly`/`disabled` cover display-only inputs.)

Known churn: `boolean_attr.pzl` golden (has handler-less `value={ name }`) picks up
synthesis — becomes a natural fixture; `attrsMultiline` formatting flips; `__h`
renumbering moves goldens. Regenerate with `-update` and eyeball.

### 4.2 Runtime (`client-runtime/`)

- `views/PuzzleView.js`: add `__bindField` (§3.3). Reserve the name in
  `DOC-SPEC-ANATOMY.md` alongside `__h`/`__ref`; check whether D133's
  `checkReservedScriptBindings` needs an entry for any newly emitted symbol.
- `viewManager.js`: **zero changes** — existing listener plumbing + live-DOM echo guard
  carry everything.
- `client-runtime/testing/index.js`: add `type(target, text)` handle helper — set
  `.value`, dispatch bubbling `input`, `await settled()` (mirror `dispatchClick`
  at `:236-276`, which already synthesizes input+change for checkboxes).

### 4.3 Examples + scaffold (the new-idiom showcase)

- `examples/todos/app/views/Home.pzl` AND
  `compiler/internal/scaffold/templates/todos/app/views/Home.pzl`: drop
  `@input={ updateNewTodoText(event) }` + the handler; keep `created()` seeding.
  Regenerate `tests/fixtures/todos/Home.compiled.js` (TestGoldenHome anchor).
- `examples/todos/app/components/TodoItem.pzl`: `checked={ todo.completed }` bare (drop
  the `@change` toggle) — exercises record+checkbox in the canonical app.
- `examples/binding/app/views/Home.pzl`: rewrite as the **record-path showcase** —
  data() returns the `profile` record itself; bind `value={ profile.displayName }` etc.;
  delete the handlers. Doubles as the `__bindField` regression case.
- Scaffold changes ride the 0.5.0 binary rebuild already happening.

### 4.4 Docs / Constellation (same change, not follow-up)

- **New `DECISION-D147`** (implicit input binding). Must record: roadmap line said
  "`bind` sugar", D147 deliberately shipped no-sugar inference; alternatives rejected:
  explicit `bind:` syntax, runtime-side synthesis, per-keystroke validation, radio/file/
  multiple/contenteditable (D44 stands), component-prop binding.
- **SPEC**: amend §6's "(two-way on inputs)" to point at new **§57** in
  `DOC-SPEC-TEMPLATE.md`: classifier shape, per-element table, suppression rule,
  coercion, `__bindField` dispatch, validation-bypass contract, two-layer hazard, island
  note.
- **Fix contradictions**: `DOC-GLOSSARY.md:31-33`; `DOC-TEMPLATE-SYNTAX.md:257-278` +
  `:506`; `DOC-EVENTS.md:76,171-185,207,249`; `DOC-USER-GUIDE.md:498-535`;
  `DOC-RELEASE-SURFACE.md:67`.
- **Cards**: update `COMPONENT-CODEGEN`, `COMPONENT-PUZZLE-VIEW` (new helper),
  `FLOW-REACTIVITY` (framework now closes the loop); connect D147 ↔
  D04/D18/D38/D44/D62/D125/D127/D133. Stamp by release per D145/D146 convention.
- **Agent skill** `skills/puzzle/SKILL.md`: add an input-binding section (it currently
  teaches NO input wiring at all — net addition, and plan.md names skill refresh a
  release blocker).
- `constellation/plan.md`: strike/amend roadmap line (binding shipped; schema-derived
  forms helper still unscheduled); add to 0.5.0 notes. Update repo `CLAUDE.md` 0.5.0
  bullet at truthing time.

### 4.5 Testing

- **Compiler**: new `binding.pzl`/`binding.golden.js` golden covering every table row +
  suppression + a non-classifying expr. Feature tests: classifier accept/reject matrix;
  suppression by `@input` AND by `@change`; component tags untouched; dynamic-type skip;
  radio/file/multiple skip; cache-index behavior. Regenerate goldens
  (`go test ./compiler/internal/codegen -run TestGoldens -update`), eyeball churn;
  `TestNodeCheck` green.
- **Runtime (vitest)**:
  1. type → setData durable across an unrelated store flush (local key, rows 1–2).
  2. derived-key revert **pinned as documented behavior** (row 3).
  3. record path end-to-end: type → record updated WITHOUT validation → subscribed
     sibling view re-renders → `record.validate()` still reports the violation.
  4. caret spy: echo render writes nothing (value-setter spy, `writes === 0`, mirroring
     `tests/vdom.test.js:147`).
  5. checkbox/select/number coercion incl. empty → null.
  6. `__bindField` on a plain object mutates + re-renders; primary-key write is a no-op.
- **Verification before claiming success**: `npx vitest run` && `cd compiler && go test
  ./...`; `npm run test:types`; build `examples/todos` + `examples/binding` with the
  repo-root `./puzzle` binary and click through in a real browser (typing, checkbox,
  select, number field; caret never jumps mid-typing). Optional: Playwright caret/IME
  check in `tests-browser/` — jsdom cannot do composition events.

---

## 5. Out of scope for v1 (say so in the card)

Radio groups; `<select multiple>`; `contenteditable` (D44 rejection stands);
component-prop binding (`<TextInput value={x}/>` stays a plain prop — no `$bindable`
analogue); index-path lvalues (`items[i].text`); the schema-derived forms helper (stays
on the roadmap); explicit opt-out syntax (`readonly` covers display-only inputs).

## 6. Why this shape (the one-paragraph pitch)

The feature is almost entirely compiler-side — the runtime already has controlled-prop
sync, caret-safe echo skipping, per-node listener plumbing, and rAF-coalesced state
writes. The compiler just synthesizes the `@input`/`@change` handler the author would
have written, using a classifier no smarter than "dotted identifier chain", with a
suppression rule that keeps every existing template byte-identical. Records get
write-through via one tiny shared helper that skips per-keystroke validation (validate at
submit with `record.validate()`, as D48 always intended). Zero new syntax, zero new
grammar, and the SPEC's decade-old "(two-way on inputs)" parenthetical finally becomes
true.
