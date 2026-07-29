# Final Binding Plan — D147 implicit two-way form binding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Synthesized 2026-07-28 from four independent plans** (`Fable-Binding-Plan.md`,
`Opus-Binding-Plan.md`, `Codex-Binding-Plan.md`, `Grok-Binding-Plan.md`). This file
supersedes all four for implementation purposes; the originals remain as research records.

**Goal:** `<input value={ newTodoText } />` two-way binds with zero new syntax — the
compiler synthesizes the write-back handler the author writes by hand today.

**Architecture:** Compiler-only detection (a narrow lexical classifier over the raw
`DynamicAttr` expression + element context), emitting a memoized runtime handler
(`this.__bind(target, field, spec)`) under a distinct `'@input:bind'` / `'@change:bind'`
listener key. The runtime gains one memoizing factory + one three-arm write dispatcher on
`PuzzleView`; `viewManager.js` needs **zero changes** (controlled props, the caret-safe
live-DOM echo guard, modifier passthrough, and `reassertSelectValue` all already carry it).

**Tech stack:** Go compiler (`compiler/internal/codegen`), browser runtime
(`client-runtime/views/PuzzleView.js`), vitest + Go goldens.

**Target:** `release/0.5.0` (unpublished; binaries already being rebuilt). Decision card
**D147**, product line **v1.68**.

---

## Adjudication — what won and why

The four plans agreed on the core: no `bind` keyword anywhere (rejects `bind:value`,
`value:bind`, `v-model`, an `<Input>` component — see D85's directive-namespace rejection
and D134's case-only-difference trap), form controls only, never components, compiler owns
the desugar, records included in v1 (locked with Cory), static-`type`-only inference,
radio/file/multiple/contenteditable/component-props excluded. They split on four points:

| Conflict | Fable | Opus | Codex | Grok | **Decision** |
|---|---|---|---|---|---|
| Author `@input`/`@change` present | suppress | suppress | both run (author first, microtask) | both run (auto first, merged) | **Suppress** |
| Record write validation | bypass validation, validate at submit | strict `update()`, catch → onError | strict `update()`, corrective render | defer records | **Strict `update()`, catch → onError** |
| Handler identity | `__h` cache for bare, fresh arrow for paths | memoized `__bind` (Map/WeakMap) | per-view writer caches | plain `__h` | **Memoized `__bind`** |
| `type="number"` event | `input` | `change` | `input` | defer coercion | **`change`** |

**Why suppression wins.** An author handler on the same event means the author owns the
write. Suppression keeps **every existing template byte-identical** (todos, TodoItem,
canvas, chat — all handler-paired), needs no migration audit of every app, no ViewManager
descriptor machinery, no capture-phase/microtask ordering guarantees, and no
double-write hazards (Codex's both-run design makes canvas's clamping handler
`Math.max(8, Number(v) || 8)` get stomped by a raw re-write of the live value; Grok's
auto-first merge silently changes existing handler semantics). It is also the natural
escape hatch — three ways to opt out, none of them new syntax: write your own handler,
use a non-path expression (`value={ draft || '' }`), or add static `readonly`.
⚠️ *Note for Cory:* the Codex session recorded "both run" as a locked decision; the
Fable session locked only scope/coercion/release. These conflict — this plan picks
suppression on the merits above. Flag if that's wrong.

**Why strict validation wins.** Fable's non-validating assign path would let
schema-invalid data into the store — subscribers, adapters, and persistence would all see
records violating their own schema, undermining the datastore's core guarantee. Instead:
call the real `record.update()`, catch `PuzzleValidationError`, route it through the D145
`onError` funnel with a new `phase: 'bind'`. Because `update()` throws **before**
mutating, state is unchanged ⇒ no render ⇒ no re-assert ⇒ the user's typed text stays on
screen. Type-directed `Number` coercion eliminates the biggest rejection class
(string-into-`number()` fields — `model.js` `checkBound` explicitly measures the value,
not the string). Documented limits: a `required()` field cannot be *cleared* through a
bind, and constrained free-text fields (`min(3)`) should bind a **local draft** and commit
on submit — the framework's D48 `record.validate()` answer. No hidden dirty-state layer.

**Why memoized `__bind` wins.** This was Opus's decisive engineering point: a fresh arrow
per render (Fable's plan for dotted paths) makes `patchAttrs` see a new function identity
every keystroke, so every `{#for}` row detaches + re-adds its native listener on every
store flush. A `__ref`-style memo (`PuzzleView.js:275-290` precedent) returns the same
function while the target identity is unchanged — `oldAttrs[name] !== value` is false,
`setAttr` never re-runs, loop-scoped binding costs nothing. It also handles loop variables
(`todo` is an arrow parameter, unreachable from any cacheable-string design) and consumes
**no `__h` site index** (critical: `attrKV` runs twice per attr — width trial then real
pass — so any counter consumed there drifts indices and churns every golden).

**Why `change` for number.** Coercion breaks the caret-preserving round-trip: type
`"1.20"` → `Number` → `1.2` → `displayValue` `'1.2'` ≠ live `'1.20'` → the patcher
rewrites the input **while the user is typing**, destroying their trailing `0`. Committing
number fields on `change` sidesteps it entirely — and matches the repo's own hand-written
idiom (`examples/canvas/app/components/Inspector.pzl:173-174`: "Sliders write on `@input`
(continuous); number fields on `@change` (commit)"). Range has no caret → `input` is fine.
Date/time kinds also commit on `change` (partial segment entry yields `''` on `input`).

Other adopted-from-one-plan pieces: Opus's `''→null` / NaN-skip numeric edges, IME
`isComposing` guard, post-commit clobber diagnostic, reserved-namespace compile error,
and downstream-mirrors analysis (nothing to do — keyword-free means no grammar changes);
Fable's `setData`-vs-model-layer hazard table, testing `type()` helper, and examples
migration (todos/scaffold/binding); Codex's one-level-path restriction, SSG/static test
matrix, and stress-benchmark preservation; Grok's phase discipline and the
"bind is the substrate, forms helper is a later product layer" split.

**Corrections to the source plans** (verified against the repo 2026-07-28):
- Opus's "expect +1 golden pair, **0 modified**" is wrong: `boolean_attr.pzl` contains a
  handler-less `value={ name }` on an `<input type="text">` — that golden **will** gain a
  synthesized bind attr. Expect exactly that diff and nothing else in it.
- Opus's "add `readonly` to stress FormState" doesn't cover the `<select>` —
  `readonly` is not a valid select attribute. Use non-classifying expressions instead
  (see Task 9).
- Fable's uncached-arrow emission for dotted paths (listener churn, above) and its
  validation bypass are overridden.
- Grok's "compose auto-write with author handler" and phase-1-locals-only scoping are
  overridden by the suppression rule and Cory's locked records-in-v1 decision.

---

## The contract (this text seeds the D147 card and DOC-SPEC-TEMPLATE §6)

### Trigger conditions — all statically decidable, ALL must hold

The compiler auto-binds a `DynamicAttr` named `value` or `checked` when:

1. The tag is a plain `<input>`, `<textarea>`, or `<select>` — never a component
   (component `value` is a plain prop; D16 callback-props model stands).
2. The expression is exactly `ident` or `ident.ident` (whitespace-trimmed). No calls,
   operators, brackets, `?.`, ternaries, formatter pipes, deeper chains
   (`a.b.c` — a nested plain object under a record would silently miss store
   notification), or `this.` prefixes. Roots in `jsKeywords`/`jsGlobals` don't classify.
   A **bare** loop variable doesn't classify (nothing writable behind it); a loop
   variable as the **root of a member path** (`todo.completed`) does.
3. The element has **no author-written `@input` or `@change`** (any modifiers). Either
   one present = author owns the write = no synthesis. Handlers on other events
   (`@keydown:enter`, `@blur`, …) do NOT suppress.
4. No static `readonly` or `disabled` attribute (the no-new-syntax opt-outs).
5. `type` is absent or a **static** string the table below classifies. Dynamic
   `type={ … }` never binds. `checked` binds only with static `type="checkbox"`;
   `value` on a checkbox (the form submit-value) never binds. Excluded types: `file`,
   `radio`, `submit`, `button`, `reset`, `image`, `hidden`. Excluded shape:
   `<select multiple>`.

Anything failing a condition compiles **exactly as today** — silently (computed value
bindings are legitimate display cases; no warning spam). Accepted cost of keyword-free:
`value={ draft }` binds but `value={ draft || '' }` doesn't, with no error. Chosen
knowingly over a marker word.

### Element / event / coercion matrix

| Control | Event | Read | Write value | Spec code |
|---|---|---|---|---|
| `<input>` absent/text-ish type (text, search, email, password, url, tel, color) | `input` | `.value` | string | `v` |
| `<input type="number">` | `change` | `.value` | `'' → null`; `Number(v)`; **skip write if NaN** | `vn` |
| `<input type="range">` | `input` | `.value` | `Number(v)`; skip if NaN | `vn` |
| `<input type="checkbox">` (on `checked=`) | `change` | `.checked` | boolean | `c` |
| date / time / month / week / datetime-local | `change` | `.value` | string | `v` |
| `<textarea>` | `input` | `.value` | string | `v` |
| `<select>` (single) | `change` | `.value` | string | `v` |

Numeric edges (verified in runtime source): `Number('')` is `0` — writing it would
rewrite a just-cleared field to `"0"` and jump the caret, so `''` writes `null` instead
(`displayValue(null)` → `''`, `client-runtime/display.js:29`, so the echo compare stays
equal and nothing is rewritten). `Number('-')` is `NaN`, which **passes** model bound
checks ("a NaN-ish comparison is a pass, never a throw", `model.js:206`) and would render
literal `"NaN"` — so NaN writes are skipped.

### Emitted JS

```js
// <input type="text" value={ draft } />
new ViewNode('input', {
  type: 'text',
  value: __d.draft,
  '@input:bind': this.__bind(null, 'draft', 'v'),
}, [])

// {#for todo in todos} <input type="checkbox" checked={ todo.completed } />
{ type: 'checkbox', checked: todo.completed, '@change:bind': this.__bind(todo, 'completed', 'c') }

// <input type="number" value={ profile.hue } />   (profile from data())
{ type: 'number', value: __d.profile.hue, '@change:bind': this.__bind(__d.profile, 'hue', 'vn') }

// <select value={ sort }> … </select>
{ value: __d.sort, '@change:bind': this.__bind(null, 'sort', 'v') }
```

- `null` target ⇒ local state (`setData` + `refresh`). Dotted path ⇒ target is the
  resolved root (loop var stays bare; data root gets `__d.`), field is the second segment.
- The `:bind` suffix rides the existing modifier channel: `viewManager.js` keys
  `LISTENERS` by the **full modified name** (`:1364`) so it's a distinct slot, and
  `withModifiers` (`:1513-1531`) passes the unrecognized `bind` modifier through untouched
  — verified, zero runtime change. It's also greppable in DevTools.
- `this.__bind(...)` is a **call evaluated during render** that returns a memoized
  function — stable identity across renders, so `patchAttrs` never re-attaches. It
  consumes **no `__h` site index**.

### Runtime dispatch — `__bind` + three-arm `#bindWrite`

```js
// client-runtime/views/PuzzleView.js — beside __ref (:275-290), same memo philosophy.

// Memo stores (private fields):
//   #bindLocalMemo : Map<key\0spec, fn>
//   #bindMemberMemo: WeakMap<target, Map<key\0spec, fn>>

__bind(target, key, spec) {
  let store;
  if (target == null) {
    store = (this.#bindLocalMemo ??= new Map());
  } else {
    const byTarget = (this.#bindMemberMemo ??= new WeakMap());
    store = byTarget.get(target);
    if (!store) byTarget.set(target, (store = new Map()));
  }
  const memoKey = key + ' ' + spec;
  let fn = store.get(memoKey);
  if (!fn) {
    fn = (event) => {
      if (event.isComposing) return;           // IME guard — see hazard notes
      const el = event.target;
      let value;
      if (spec === 'c') value = !!el.checked;
      else if (spec === 'vn') {
        if (el.value === '') value = null;
        else {
          value = Number(el.value);
          if (Number.isNaN(value)) return;     // never store NaN
        }
      } else value = el.value;
      this.#bindWrite(target, key, value);
    };
    store.set(memoKey, fn);
  }
  return fn;
}

#bindWrite(target, key, value) {
  if (target == null) {
    this.setData(key, value);
    this.refresh();                            // derived data() values stay live — see below
    if (__PUZZLE_DEV__) (this.#bindPending ??= new Map()).set(key, value);
  } else if (typeof target.update === 'function' && typeof target._type === 'string') {
    // PuzzleModel duck-type (update + _type together): PuzzleView.js must not
    // import model.js. Strict validation stands; update() throws BEFORE mutating.
    try {
      target.update({ [key]: value });         // store rAF flush drives the re-render
    } catch (err) {
      reportError(this.ctx, err, { phase: 'bind', view: this, route: this.route });
    }
  } else {
    target[key] = value;                       // plain object: mutate + repaint owner
    this.refresh();
  }
}
```

**Why `refresh()` and not bare `setData` for locals:** the whole point is no glue. A
bound filter field (`value={ filterText }` feeding `data()`'s
`todos.filter(...)`) must narrow its list as you type; plain `setData` never re-runs
`data()`, so the magic would be silently broken for exactly the search-box case. Cost: one
`data()` re-run + vnode diff per keystroke — the same cost any store change already
incurs; the echo guard keeps actual DOM writes at zero for the input itself.

### The five hazards (all resolved, all documented in the card)

1. **Caret** — emergent from `viewManager.js:1099-1120`: `value`/`checked` compare
   against the **live DOM property**; the per-keystroke echo (state already equals the
   live value) writes nothing. Uncoerced string binds round-trip byte-identically.
   Coercion breaks the round-trip → number commits on `change`. Pinned by the existing
   value-setter spy test (`tests/vdom.test.js:147-179`) plus new ones.
2. **IME composition** — once the framework owns the listener it owns this: a transform
   or late re-assert mid-composition aborts the IME session in Chrome/Safari.
   `if (event.isComposing) return;` — the final `input` after `compositionend` carries
   `isComposing: false`, so the value still lands. (An app already needed this by hand:
   `examples/grimoire/app/views/Doc.pzl:475`.) Verify in a real browser.
3. **Validation throws** — strict `update()` stands (see adjudication). Caught, routed to
   `reportError` with new `phase: 'bind'` (add to the `PuzzleErrorInfo['phase']` union in
   `types/index.d.ts:117-127`). State unchanged ⇒ typed text survives until the next
   store-driven commit. Documented limits: `required()` fields can't be cleared via bind;
   constrained free-text binds a local draft, commits with `record.update()` on submit,
   validates with D48's non-throwing `record.validate()`.
4. **Layer clobber** — `#recompose` composes `{ ...#local, ...#model }`, model last: a
   `setData` write for a key `data()` also derives from a record/prop is reverted on the
   next commit. Compiler can't detect it (data() is opaque bytes — D03). Taught rule:
   **bind the path you want written** — `value={ profile.displayName }` for record forms,
   bare `value={ draft }` for local drafts. Dev-only diagnostic (Task 7): record
   `{key → writtenValue}` at bind-write time; at the next recompose, if `#data[key]`
   differs from what was written and no later bind superseded it, warn once per key.
   (A naive `key in #model` check false-positives on the legitimate echo idiom —
   `examples/static-docs/app/views/Playground.pzl:46` reads its own local write back out.)
   Gate **inline** on `__PUZZLE_DEV__` — never a hoisted const (`PuzzleView.js:40-46`,
   esbuild constant folding).
5. **Islands** — a bind inside an `island` subtree attaches at mount and survives the
   freeze; data flows out of the island, never into it (§17). Document, don't
   special-case.

### Out of scope for v1 (state in the card)

Radio groups; `<select multiple>`; file inputs; `contenteditable` (D44 rejection stands —
third confirmation); component-prop binding (no `$bindable` analogue; D16 stands); paths
deeper than one member (`a.b.c`, `items[i].text`); path-aware `setData`; debounce/lazy
modifiers; validation display / dirty tracking; the schema-derived forms helper (separate
roadmap item — bind is the substrate, forms are a later product layer); explicit
`bind:`/opt-out syntax (the three no-syntax escapes cover it).

---

## Global Constraints

- No parser/lexer grammar changes; no new public syntax; `.pzl` scripts remain opaque
  bytes to Go (D03).
- Every template failing a trigger condition must emit **byte-identically** to today.
- The synthesized attr must consume no `c.handlerSites` (`__h`) index — `attrKV` runs
  twice per attr (width trial `emit=false` at `codegen.go:1058-1075`, then real pass).
- `viewManager.js` is not modified.
- `PuzzleView.js` must not import `model.js` (duck-type detection).
- Dev-only code gates inline on `__PUZZLE_DEV__`, never via a hoisted const.
- Cards: one decision, one card — rewrite `DOC-GLOSSARY` "controlled property" in place;
  no superseding chain; no SHAs/PR numbers in card prose.
- Verification floor before any success claim: `npx vitest run` && `cd compiler && go
  test ./...`; report anything not run.
- Delegation per repo model policy: Fable orchestrates/reviews; substantial code slices go
  to background agents (Codex/Opus) with tight briefs.

---

## Tasks

### Task 1: D147 decision card + feature card (planned)

**Files:**
- Create: `constellation/decision/DECISION-D147-IMPLICIT-TWO-WAY-BINDING.md`
- Create: `constellation/feature/FEATURE-IMPLICIT-BINDING.md` (status `planned`)
- Modify: `constellation/plan.md` (roadmap line ~:202; 0.5.0 section; card index)

**Steps:**
- [x] Write D147 from "The contract" above, plus Alternatives rejected: `bind:value`
      (re-litigates D85's namespace rejection + 3 editor grammars), bare `bind`/`sync`
      marker, options-object `bind={{…}}` (compile error, `codegen.go:1130`), Ember-Octane
      `<Input>` component (no spread-props; D134 case trap), runtime-only helper,
      Vue-style `__d.x =` lowering (getData returns a copy), both-run handler composition
      (double-write/stomp hazards), validation bypass (schema-invalid records in the
      store), always-warn on non-classifying expressions (spam on legit display cases).
      Scope line verbatim from "Out of scope". Connect: D04/D16/D18/D23/D38/D44/D48/D62/
      D85/D125/D133/D134/D145/D146, COMPONENT-CODEGEN, COMPONENT-PUZZLE-VIEW,
      FLOW-REACTIVITY, DOC-SPEC-TEMPLATE.
- [x] Feature card `planned`, connected to the decision + the files this plan touches.
- [x] `plan.md`: move "two-way `bind` sugar" out of identified-not-scheduled (note the
      shipped shape is no-sugar inference); keep "schema-derived forms helper" as its own
      unscheduled line; add D147 to the 0.5.0 section and card index.
- [x] Commit: `docs: D147 implicit two-way binding — decision + planned feature card`

### Task 2: Reserved attr-namespace compile error (standalone; ship regardless)

Closes the silent hole where `bind:value={x}` lexes today as one attr name
(`lexer.go:452-454` allows `:` and `.` in names) and compiles into a dead literal DOM
attribute.

**Files:**
- Modify: `compiler/internal/parser/parser.go` (`buildAttr`, :481-521)
- Modify: `compiler/internal/parser/ast.go:176-177` (fix the false "two-way bindings
  alike" docstring)
- Test: `compiler/internal/parser/parser_test.go`

**Steps:**
- [x] **Failing test first:** `bind:value={ x }` on an element produces a positioned
      `ParseError` naming the reserved namespace; `xlink:href="…"`, `xml:lang="…"`, and
      `xmlns:*` still parse (SVG passes through `attrsMultiline`/`emitAttrs` via
      `inlinesvg.go:185/189` — grep the examples for colon-named SVG attrs and cover
      every prefix found).
- [x] Implement in `buildAttr`: non-`@` attr name containing `:` errors unless the prefix
      is in the XML allowlist (`xml`, `xlink`, `xmlns`). Error text steers: "attribute
      namespaces are reserved; two-way binding is automatic on form controls — see
      template SPEC §6".
- [x] `go test ./compiler/internal/parser/...` green; full `go test ./...` green (proves
      no existing example/golden uses a non-allowlisted colon attr).
- [x] Commit: `compiler: reserve non-XML attr namespaces with a positioned error`

### Task 3: Bind classifier (Go, pure function + table test)

**Files:**
- Create: `compiler/internal/codegen/binding.go`
- Test: `compiler/internal/codegen/binding_test.go`

**Interfaces (produces):**
```go
// classifyBindExpr reports whether raw is exactly `ident` or `ident.ident`.
// bare==true  => field is the local key ("draft"), target is "".
// bare==false => target is the ROOT segment (unresolved), field the second.
// Roots in jsKeywords/jsGlobals never classify. A bare root present in scope
// (a {#for} variable) never classifies; a scoped root of a member path does.
func classifyBindExpr(raw string, scope map[string]bool) (target, field string, bare, ok bool)
```

**Steps:**
- [x] **Failing table test** (reuse `isIdentStart`/`isIdentChar` from `expr.go:57-63`):
      accept `draft`, ` draft `, `todo.completed`, `profile.displayName`, `_x.y`;
      reject `a.b.c`, `fmt(x)`, `x.trim()`, `a + b`, `a ?? ''`, `a ? b : c`,
      `todo[k]`, `a?.b`, `x | money`, `this.x`, `true`, `window`, `event.target`,
      `''`, `{ a: 1 }`, and bare `todo` when `scope = {"todo": true}` — but accept
      `todo.completed` under the same scope with `target == "todo"`.
- [x] Implement: trim; split on `.`; 1–2 segments; each segment a full identifier; root
      not in `jsKeywords`/`jsGlobals` (`expr.go:19-46`); bare root not in `scope`.
- [x] `go test ./compiler/internal/codegen -run TestClassifyBindExpr` green.
- [x] Commit: `compiler: bind-target classifier for implicit two-way binding`

### Task 4: Synthesis in codegen + goldens

**Files:**
- Modify: `compiler/internal/codegen/binding.go` (add detection over the element)
- Modify: `compiler/internal/codegen/codegen.go` (`attrsMultiline` :1058, `emitAttrs`
  :1079 — both, because `inlinesvg.go:185/189` calls the pair directly)
- Create: `compiler/internal/codegen/testdata/binding.pzl` + `binding.golden.js`
- Test: `compiler/internal/codegen/binding_test.go`, existing golden harness

**Interfaces (produces):**
```go
type autoBind struct {
    event  string // "input" | "change"
    target string // "" for bare; else the RAW root segment (resolution happens at emit)
    field  string
    spec   string // "v" | "vn" | "c"
}
// detectAutoBind inspects the whole element (conditions are sibling-aware) and
// returns nil when nothing binds. Pure; safe to call from both the width trial
// and the real pass. Consumes no compiler state.
func detectAutoBind(tag string, attrs []parser.Attr, scope map[string]bool) *autoBind
```

**Steps:**
- [x] **Failing golden:** write `binding.pzl` covering every matrix row + the negative
      space — text input bare, number (change/vn), range (input/vn), checkbox `checked`
      on loop var, select single, textarea, member path on a data root; suppression by
      author `@input`, suppression by author `@change:prevent`, non-suppression by
      `@keydown:enter`; `readonly` opt-out; dynamic `type={t}` skip; radio/file skip;
      `<select multiple>` skip; component `<Foo value={x}/>` skip; `value={ x.trim() }`
      one-way. Hand-write `binding.golden.js` to the emitted shapes in the contract.
- [x] Implement `detectAutoBind` per the trigger conditions (static-type lookup mirrors
      the a11y pass, `a11y.go:36` — never guess runtime values). Event-attr matching
      strips modifiers: base name before the first `:` decides `@input`/`@change`.
- [x] Wire into `attrsMultiline` AND `emitAttrs`: after the authored attrs, emit the KV
      `'@<event>:bind': this.__bind(<target>, '<field>', '<spec>')`, where `<target>` is
      `null` (bare), the bare scope var, or `__d.<root>`. The width trial must count the
      synthesized attr so single/multi-line layout stays deterministic. No `__h` index.
- [x] Add a width-trial canary test: a template mixing one auto-bind with several cached
      `@click` handlers asserts `__h` indices run `0..n` with no gap.
- [x] `go test ./compiler/internal/codegen -run TestGoldens -update`; **expected churn:
      the new pair + `boolean_attr.golden.js` gains exactly
      `'@input:bind': this.__bind(null, 'name', 'v')` (its `value={ name }` is
      handler-less — verified) — audit any OTHER modified golden line-by-line; each diff
      must be exactly a synthesized bind attr or its multiline reflow.** `TestNodeCheck`,
      `TestGoldenHome`, `TestGoldenDefault` still green (todos is handler-paired ⇒
      suppressed ⇒ untouched at this task).
- [x] `cd compiler && go test ./...` green.
- [x] Commit: `compiler: synthesize implicit two-way bind handlers on form controls`

### Task 5: Runtime `__bind` + `#bindWrite` + error phase

**Files:**
- Modify: `client-runtime/views/PuzzleView.js` (beside `__ref`, :275-290)
- Modify: `types/index.d.ts:117-127` (`'bind'` in the `PuzzleErrorInfo['phase']` union)
- Modify: `constellation/doc/DOC-SPEC-ANATOMY.md` (reserve `__bind` beside `__h`/`__ref`;
  check whether D133's `checkReservedScriptBindings` needs the entry)
- Test: `tests/binding.test.js` (new)

**Steps:**
- [x] **Failing tests** (compile small fixtures via the existing pretest pipeline, mount
      with `client-runtime/testing`):
  - local arm: dispatch `input` on a bound text input → `getData().draft` updates →
    a derived value computed in `data()` from `draft` also updates (refresh proof) →
    one paint per keystroke (no redundant second render).
  - member/record arm: typing writes the record **through `update()`** (spy), a
    subscribed sibling view re-renders, persistence write-sync observes the change.
  - member/plain-object arm: mutates + re-renders the owner.
  - record detection is duck-typed: a plain object with only an `update` method takes the
    plain-object arm (needs `_type` too).
  - validation: `update()` throw → `onError` fires with `phase: 'bind'`, record
    unchanged, input's DOM text preserved (no render happened).
  - coercion: number `''` → `null`; `NaN` input value → **no write at all**; range →
    number; checkbox → boolean; select on `change` → string.
  - identity: two consecutive renders return the **same** function from `__bind` for the
    same (target, key, spec); a replaced record object yields a new one.
  - `event.isComposing` true → no write.
  - caret regression: value-setter spy asserts `writes === 0` on the echo render
    (mirror `tests/vdom.test.js:147-179`).
- [x] Implement `__bind` and `#bindWrite` exactly as in the contract (memo maps, IME
      guard, three arms, `reportError` with `phase: 'bind'`).
- [x] `npx vitest run` + `npm run test:types` green.
- [x] Commit: `runtime: memoized __bind write-back dispatch for implicit binding`

### Task 6: `type()` testing helper

**Files:**
- Modify: `client-runtime/testing/index.js` (mirror `dispatchClick` :236-276)
- Test: extend `tests/binding.test.js`

**Steps:**
- [x] **Failing test:** `await type(handle, 'hello')` on a bound input leaves
      `getData().draft === 'hello'` after `settled()`.
- [x] Implement `type(target, text)`: set `.value`, dispatch bubbling `input` (and
      `change` for completeness on blur-style controls), `await settled()`.
- [x] Export + `npm run test:types` green (public `/testing` surface — add the d.ts
      signature).
- [x] Commit: `testing: type() helper for two-way-bound inputs`

### Task 7: Dev-only clobber diagnostic

**Files:**
- Modify: `client-runtime/views/PuzzleView.js` (`#recompose` / commit path, :1529-1535)
- Test: extend `tests/binding.test.js`

**Steps:**
- [x] **Failing tests:** (a) bind a key that `data()` derives from a record → trigger a
      store flush → exactly one console warning naming the key; second flush warns
      nothing. (b) the legitimate echo idiom (`data()` re-reads `getData().text`,
      Playground-style) never warns. (c) production build path (`__PUZZLE_DEV__` false)
      emits nothing.
- [x] Implement: `#bindPending` map written in the local arm (already stubbed in Task 5);
      at recompose, for each pending key, if `#data[key] !== written` warn once per key
      (`#bindWarned` set) with the taught fix ("bind the source path, or stop deriving
      '<key>' in data()"); clear pending. Inline `__PUZZLE_DEV__` gates.
- [x] `npx vitest run` green.
- [x] Commit: `runtime: dev warning when a data() commit reverts a bound local key`

### Task 8: SSG / static / hybrid coverage

**Files:**
- Test: extend the existing SSG serializer suite (`client-runtime/ssg/` tests) + a
  static-output integration case

**Steps:**
- [x] **Failing tests:** serialized HTML for a bound input contains the controlled
      initial value but **no** `@input:bind`/`@change:bind` (the `@` prefix strip rule
      covers it — pin it); textarea text content, selected option, and `checked`
      serialize as today; hybrid takeover and `mountStatic` both attach the bind listener
      (type after mount → state updates).
- [x] Fix anything the pins surface (expected: nothing).
- [x] `npx vitest run` green.
- [x] Commit: `ssg: pin bind-listener stripping and post-takeover binding`

### Task 9: Examples, scaffold, and fixture migration

**Files:**
- Modify: `examples/binding/app/views/Home.pzl` (+ its `package.json` description is
  finally true) — **the acceptance case**
- Modify: `examples/stress/app/scenarios/FormState.pzl` + `examples/stress/README.md`
- Modify: `examples/todos/app/views/Home.pzl`, `examples/todos/app/components/TodoItem.pzl`
- Modify: `compiler/internal/scaffold/templates/todos/app/views/Home.pzl` + `…/components/TodoItem.pzl`
- Modify: `tests/fixtures/todos/Home.compiled.js` (**hand-maintained — the fixture wins;
  NOT `-update`-regenerable**, `golden_test.go:168-178`)
- Test: `tests/helpers/todos-suite.js` lanes, `npm run lint:examples`

**Steps:**
- [x] **FormState first (benchmark preservation):** its handler-less `value={ row.text }`
      / `value={ row.choice }` would now auto-bind and change what the benchmark
      measures. Make both intentionally non-classifying — `value={ String(row.text) }`
      and `value={ String(row.choice) }` — with a one-line comment (`readonly` is not
      valid on `<select>`, and it would change the demo's interactivity). Note the
      escape in the stress README.
- [x] **binding example:** rewrite as the record-path showcase — `data()` returns the
      `profile` record; bind `value={ profile.displayName }`, `value={ profile.hue }`
      (a `Puzzle.number()` field — exercises `vn` coercion end-to-end), textarea, color,
      range; delete the entire mirror-handler `events` block. This is the
      `#bindWrite` record-arm regression app.
- [x] **todos + scaffold (the flagship must demo the flagship feature):** drop
      `@input={ updateNewTodoText(event) }` + the handler from both Home.pzl copies
      (keep `created()` seeding); in both TodoItem.pzl copies, `checked={ todo.completed }`
      bare, drop the `@change` toggle plumbing. Hand-edit
      `tests/fixtures/todos/Home.compiled.js` to the new compiled output (compile with
      `pzlc`, then apply the documented normalizations); `TestGoldenHome` +
      `parser/integration_test.go` + `build_test.go` green.
- [x] Audit the remaining corpus: `rg -n 'value=\{|checked=\{' examples -g '*.pzl'`,
      inspect every handler-less hit for unintended new binding; fix or bless each.
      (One real catch: `music/Playlist.pzl`'s inline rename. Its `@keydown:enter`
      / `@keydown:escape` do NOT suppress, so it newly bound live and Escape
      could no longer cancel — escaped with `String(playlist.name)`.)
- [ ] Build todos + binding with the repo-root `./puzzle` binary; click through in a real
      browser: typing (caret never jumps mid-word), checkbox, select, number commit on
      change, range slider live. **IME check:** compose Japanese into a bound input — no
      dropped characters. (jsdom can't do composition or number-input sanitization.)
- [x] `npx vitest run` && `cd compiler && go test ./...` && `npm run lint:examples` green.
      (`lint:examples` is not a script in this repo — no `lint*` script exists.
      Stood in for it: `npm run pretest`, which recompiles every example through
      the compiler, plus full `./puzzle build` runs of todos and binding in both
      development and production, and `npm run test:types`.)
- [x] Commit: `examples: adopt implicit binding (todos, scaffold, binding); preserve stress benchmark`

### Task 10: Docs truthing + skill + card stamps

**Files:**
- Modify: `constellation/doc/DOC-SPEC-TEMPLATE.md` §6 (~:87) — the full contract; the
  "(two-way on inputs)" parenthetical finally becomes true
- Modify: `constellation/doc/DOC-GLOSSARY.md:31-33` (rewrite "controlled property" in
  place), `DOC-TEMPLATE-SYNTAX.md:257-278` + cheat-sheet :506, `DOC-EVENTS.md`
  (:76, :171-185, :207, :249), `DOC-USER-GUIDE.md:498-535`, `DOC-RELEASE-SURFACE.md`,
  `README.md:201-202` + :396-402
- Modify: `skills/puzzle/SKILL.md` (go:embed'd — **must land in the same release** or
  agents scaffold stale guidance; it currently teaches no input wiring at all)
- Modify: cards — `COMPONENT-CODEGEN`, `COMPONENT-PUZZLE-VIEW`, `FLOW-REACTIVITY`,
  feature card → `built`; repo `CLAUDE.md` 0.5.0 bullet
- Modify: `DECISION-D44-DOM-ISLANDS.md:63` — its `value=` justification is now literally
  true; touch only if its prose reads as fiction-era

**Steps:**
- [ ] Rewrite each doc to state the current design as if it were always the design (no
      "previously"/"we changed" narration). Teach: the trigger conditions, the matrix,
      the three escapes, bind-the-source-path rule, local-draft idiom for constrained
      fields, `type()` helper.
- [ ] Skill: add the input-binding section (when it binds, when it doesn't, the
      record-vs-draft choice, the suppression rule).
- [ ] `mcp` card updates + connections; product line v1.68 entry; stamp cards by release
      (`0.5.0` + `verified_sha` convention) **after** Task 11 verification, not before.
- [ ] Commit: `docs: implicit two-way binding — SPEC §6, glossary, guides, skill, cards`

### Task 11: Full verification sweep

**Steps:**
- [ ] `npx vitest run` — green, zero skips introduced.
- [ ] `cd compiler && go test ./...` — green.
- [ ] `npm run test:types` && `npm run verify:pack` — green.
- [ ] Rebuild the repo-root `./puzzle` binary; `puzzle init` a scratch app in the
      scratchpad; confirm the scaffolded todos demos handler-less binding out of the box.
- [ ] Real-browser pass (todos + binding, per Task 9): caret, IME, number commit, select,
      checkbox, range; DevTools extension still shows the views/store panels sane with
      `:bind` listeners present.
- [ ] Constellation `check_integrity` + `check_sync`; stamp D147/feature/component cards
      `verified`.
- [ ] Report anything not run.

---

## Effort and sequencing

≈4–6 engineer-days. Tasks 1–2 are independent and can start immediately (Task 2 is
shippable standalone). Tasks 3→4 and 5→6→7 are two parallel tracks (compiler / runtime)
that join at Task 8. Task 9 needs 4+5; Tasks 10–11 close. Per the repo model policy:
Fable writes the card text and reviews every diff; Tasks 3–9 are delegated to background
agents (Codex/Opus) with this file's task blocks as the briefs.
