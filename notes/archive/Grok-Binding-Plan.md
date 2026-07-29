# Natural Two-Way Form Binding for Puzzle

**Author:** Grok research / design session  
**Date:** 2026-07-28  
**Status:** Design plan only — not implemented  
**Product goal:** Make form controls two-way by default from ordinary template attrs, with **no special syntax** (`value:bind`, `bind:value`, `v-model`, etc.). The author writes:

```html
<input value={ newTodoText } />
```

…and the framework handles both directions. Drop the glue. Feel like Ember Classic / AngularJS ergonomics, on top of Puzzle’s modern controlled runtime.

**Explicit non-goals of this note:** implementation code, schema-derived form widgets, contenteditable binding, component-prop two-way (parent↔child), inventing a bind directive as the *primary* surface.

---

## Table of contents

1. [The ask](#1-the-ask)
2. [What ships today](#2-what-ships-today)
3. [Why it felt like we already had this](#3-why-it-felt-like-we-already-had-this)
4. [How other frameworks do it](#4-how-other-frameworks-do-it)
5. [What Puzzle already has that makes this easy](#5-what-puzzle-already-has-that-makes-this-easy)
6. [What Puzzle does *not* have (hard parts)](#6-what-puzzle-does-not-have-hard-parts)
7. [Complexity assessment](#7-complexity-assessment)
8. [Recommended product design](#8-recommended-product-design)
9. [Assignable lvalue rules](#9-assignable-lvalue-rules)
10. [Element / attribute / event matrix](#10-element--attribute--event-matrix)
11. [Write-target resolution (local vs store)](#11-write-target-resolution-local-vs-store)
12. [Composition with author handlers](#12-composition-with-author-handlers)
13. [Two-layer state interaction](#13-two-layer-state-interaction)
14. [Ember Data magic — what auto-bind does and doesn’t buy](#14-ember-data-magic--what-auto-bind-does-and-doesnt-buy)
15. [Before / after: todos](#15-before--after-todos)
16. [Implementation phases](#16-implementation-phases)
17. [Codegen sketch (phase 1)](#17-codegen-sketch-phase-1)
18. [SPEC / API contract sketch](#18-spec--api-contract-sketch)
19. [Risks and edge cases](#19-risks-and-edge-cases)
20. [Test plan](#20-test-plan)
21. [Docs / constellation work](#21-docs--constellation-work)
22. [Effort estimate](#22-effort-estimate)
23. [Open product choices](#23-open-product-choices)
24. [Recommendation](#24-recommendation)
25. [Suggested next steps](#25-suggested-next-steps)
26. [Code & doc map (for implementers)](#26-code--doc-map-for-implementers)
27. [Appendix: framework research notes](#27-appendix-framework-research-notes)

---

## 1. The ask

For a long time the mental model was Ember-like:

> Just put `value={ someField }` on an input and the framework keeps the DOM and the model in sync. No handlers. No glue. Fast to prototype, fast to ship.

In Puzzle today that is **not** how it works. Authors must write both sides:

```html
<input value={ newTodoText } @input={ updateNewTodoText(event) } />
```

```js
updateNewTodoText: (event) => {
  this.setData('newTodoText', event.target.value);
}
```

**Constraint from product taste:** do **not** require special syntax to opt into two-way. Rejected as primary surface:

- `value:bind={ newTodoText }`
- `bind:value={ newTodoText }` (Svelte)
- `v-model="newTodoText"` (Vue)
- `[(ngModel)]="newTodoText"` (Angular)

The default on form controls should be the magic. One-way remains available via non-assignable expressions (and possibly later escapes).

**North star:** remove as much glue as Ember Data + two-way helpers did for simple apps — render the template, type into fields, read state on submit.

---

## 2. What ships today

### Template / author pattern

From `examples/todos/app/views/Home.pzl` and scaffold templates:

```html
<input
  type="text"
  value={ newTodoText }
  @input={ updateNewTodoText(event) }
  autofocus
/>
```

Checkbox rows go through callback props + domain methods, not direct field binding:

```html
<!-- TodoItem.pzl -->
<input type="checkbox" checked={ todo.completed } @change={ toggle(event) } />
```

```js
// parent Home
toggleTodo: (todo) => { todo.toggle(); }
```

### Codegen

- `value={ expr }` is a `DynamicAttr` → emitted as `value: <resolved expr>` (typically `__d.newTodoText` after `resolveExpr`).
- `@input={ updateNewTodoText(event) }` is an `EventAttr` → emitted as `'@input': ((this.__h ??= {})[n] ??= (event) => this.events.updateNewTodoText(event))` (D62 handler cache when cacheable).
- No writeback is inferred. The parser even comments that `DynamicAttr` “covers dynamic attributes and two-way bindings alike” — but codegen does not implement two-way.

Relevant files:

- `compiler/internal/parser/ast.go` — `DynamicAttr`, `EventAttr`
- `compiler/internal/codegen/codegen.go` — `attrKV`, `emitAttrs`
- `compiler/internal/codegen/expr.go` — `resolveExpr` (identifier roots → `__d.<name>`)

### Runtime (ViewManager)

Controlled form properties are already first-class:

- `PROPS = value | checked | disabled | selected | muted` — set as **element properties**, not attributes.
- On patch, `value` on `INPUT`/`TEXTAREA` and `checked` on `INPUT` compare against the **live DOM property**, not just the previous vnode value — so out-of-band user typing doesn’t leave a stale controlled value, and the keystroke echo path (bound value already equals live value) writes **nothing** (caret preserved).
- `<select>` re-asserts `value` after option children settle (`reassertSelectValue`).

Relevant file: `client-runtime/views/viewManager.js` (see `patchAttrs`, `PROPS`, `reassertSelectValue`).

### State owners

| Owner | API | Re-runs `data()`? | Typical use |
|---|---|---|---|
| Local UI state | `this.setData(key, value)` or map | **No** — schedule re-render only | drafts, filters, toggles |
| Store records | `record.update(patch)`, model methods, `createRecord`, `destroy` | **Yes** — via store subscriptions | shared domain data |

Two-layer component state (SPEC §4, Change C):

- `#local` — setData / created() seeds
- `#model` — last successful `data()` commit (replaced wholesale)
- `#data` — composed `{ ...#local, ...#model }` (model overlays local for shared keys)
- Precedence: a `data()` commit beats an earlier setData for a shared key; a later setData beats the model until the next commit

Relevant file: `client-runtime/views/PuzzleView.js` (`setData`, `#recompose`, `#commit`).

### Documented contract (truthful docs)

From `constellation/doc/DOC-TEMPLATE-SYNTAX.md`:

> On form inputs, `value={ variable }` keeps the DOM property synchronized from component data. Puzzle **does not infer the write-back expression**: pair it with an `@input` handler that updates local or store state…

From `constellation/doc/DOC-GLOSSARY.md`:

> **controlled property** — Form/boolean properties such as `value`, `checked`, `selected`, or `disabled` synchronized as DOM properties during patches. Puzzle **does not infer a two-way state assignment**; event handlers update state.

From `constellation/plan.md` backlog (identified, **not** scheduled):

> two-way `bind` sugar plus a schema-derived forms helper

---

## 3. Why it felt like we already had this

Several places still speak as if two-way exists:

| Source | Claim |
|---|---|
| `DOC-SPEC-TEMPLATE` §6 | `value={ var }` **(two-way on inputs)** |
| `parser/ast.go` `DynamicAttr` comment | “covers dynamic attributes and **two-way bindings** alike” |
| `tests/helpers/todos-suite.js` | comments about “two-way-bound render” between input and submit |
| D44 / islands docs | contrast contenteditable against “`value=` on inputs works” (meaning controlled, sometimes misread as two-way) |

**Reality:** the *idea* has been in the design language since early on; the *feature* was never built. One-way controlled props + manual handlers is the shipped contract. Any implementation work must **rewrite** the stale SPEC line into a real decision, not leave fiction standing.

Also noted historically: FEATURE-V1-32 release hardening wrote “binding forms unsupported” into SPEC §6 as the expression-boundary contract (lexed-not-parsed). That is about object-literal / expression limits, not form two-way — but it is another place “binding” language appears.

---

## 4. How other frameworks do it

### Svelte — explicit `bind:`, lvalue-checked, compiler-owned

```html
<input bind:value={ message } />
<!-- shorthand when names match: -->
<input bind:value />
```

Key properties:

- **Opt-in.** Bare `value={ message }` is one-way.
- Expression must be an **lvalue** (variable or object property). Non-lvalues are rejected or not bindable.
- Compiler emits: set the property + install an event listener that assigns back.
- If the element already has a listener for the same event, the **author listener runs first**, then the bind update.
- Type-aware matrix: `value`, `checked`, `group` (radio/checkbox groups), `files`, select multiple → array, number/range coercion, media bindings, dimensions (readonly), `bind:this`, component `$bindable` props.
- Svelte 5+ also supports **function bindings**: `bind:value={ get, set }` for transforms/validation.
- Two-way is considered “safe” in Svelte because **reactivity tracks dependencies** (`$state` / `$:` / runes). When the bound var changes, derived expressions recompute. Traditional two-way (AngularJS) was unsafe largely because derived state did not recompute automatically.

Docs: https://svelte.dev/docs/svelte/bind  
Essay: https://imfeld.dev/writing/how_svelte_makes_two_way_binding_safe

### Ember — classic magic, Octane DDAU retreat

- **Classic components / built-in `<Input @value={{this.x}}>`:** two-way. Closest product feel to “just write the template.”
- **Octane Glimmer components:** Data Down, Actions Up — **no** two-way for component arguments. Mutating `this.args.x` is not how you write back.
- Nuance: `<Input @value={{@post.title}}>` mutates the **property of the passed object** (`post.title`), not the arg binding itself — objects are not frozen.
- Community guidance often prefers native `<input>` + manual wiring for clarity; two-way on `<Input>` is a Classic holdover.
- **Ember Data** made records mutable + observable, so binding into `post.title` felt free — the data layer carried the write path and notifications.

Octane cheat sheet: Glimmer has no two-way for component args. Classic did.

### Vue — named `v-model` sugar

```html
<input v-model="text" />
<!-- desugars roughly to: -->
<input :value="text" @input="text = $event.target.value" />
```

- Still a **named directive**, not bare `value=`.
- Type-aware: checkbox → checked + change; number → number coercion; select/radio special-cased.
- Component `v-model` is separate sugar for `modelValue` + `update:modelValue` (or named `v-model:title` etc. in Vue 3).

### Angular — banana-in-a-box, still explicit

```html
<input [(ngModel)]="firstName" />
```

- Combines property binding `[]` and event binding `()`.
- Template-driven forms via `FormsModule`; reactive forms intentionally one-way + control API.
- Same underlying desugar: property in + event out.

### React — no two-way at all

```jsx
<input value={x} onChange={e => setX(e.target.value)} />
```

Maximally explicit. Puzzle today is closest to this model (controlled property + manual handler), with a nicer template grammar.

### Comparison table

| Framework | Primary “magic” surface | Bare `value=` two-way? |
|---|---|---|
| Svelte | `bind:value` | No |
| Vue | `v-model` | No |
| Angular | `[(ngModel)]` | No |
| Ember Classic `<Input>` | `@value` on helper | Yes (on the helper) |
| Ember Octane native input | manual | No |
| React | none | No |
| **Puzzle today** | none | No |
| **Puzzle goal (this plan)** | **bare `value={ x }` on form controls** | **Yes** |

**Takeaway:** the product ask is **more magic than Svelte/Vue/Angular** — closer to Ember Classic / AngularJS ergonomics — **without** a special directive name. That is a deliberate product choice, not a free port of Svelte’s design. It is doable; the **compiler** must own the desugar so the runtime stays dumb.

---

## 5. What Puzzle already has that makes this easy

These pieces are load-bearing and already correct:

1. **Controlled property patching** — `value`/`checked` as properties; live-DOM compare; caret preservation on echo.
2. **`setData` without re-running `data()`** — keystroke-cheap local updates (exactly what form drafts need).
3. **Two-layer state** — local keys survive store-driven `data()` commits when the model omits them or re-reads local.
4. **Event emission pipeline** — `@event` → per-node listeners, modifiers, D62 handler cache, composition with component callback props (D16).
5. **Expression rewriter** — `resolveExpr` already classifies identifier roots vs property access vs scope vars (`event`, `{#for}` items). Lvalue detection can sit beside this.
6. **Store notifications** — `record.update` → `recordChanged` → subscribed views refresh. Phase-2 record binding has a notification path.
7. **Select value re-assert** — option list churn won’t desync a controlled select.

In other words: the hard runtime work for **one-way controlled** forms is done. Two-way is mostly **compiler sugar that emits the write listener you already write by hand**.

---

## 6. What Puzzle does *not* have (hard parts)

| Gap | Why it matters |
|---|---|
| No reactive `let` assignment | Svelte can emit `message = e.target.value`. Puzzle must emit `this.setData(...)` or `record.update(...)`. |
| `setData` is top-level only | `value={ form.email }` has no path-aware write today. `getData()` returns a **copy**, so mutating it is a common footgun already documented in DOC-EVENTS. |
| Records reject bare property assign for notification | `todo.completed = true` does not notify. Must use `todo.update({ completed: true })`. |
| `update()` **throws** on schema validation failure | Keystroke binding into a `min(3)` field can explode mid-type. |
| No compile-time types on template exprs | Compiler cannot know `todo` is a PuzzleModel vs a plain object. Runtime helper or convention required for member paths. |
| No component bindable-prop protocol | `<Child value={ x } />` writing back to parent needs something like Svelte `$bindable` / Vue component v-model — separate feature. |
| No radio group primitive | Svelte’s `bind:group` needs shared identity across multiple inputs. |
| Scripts are opaque to Go | “Never parse the script body” (D03). Bind cannot depend on analyzing `events = { ... }` or TypeScript types. All intelligence is in the **template** expression + tag/attr context. |

---

## 7. Complexity assessment

| Scope | Difficulty | Why |
|---|---|---|
| Local bare identifiers (`value={ newTodoText }`) | **Low–medium** | Emit `@input` → `setData('newTodoText', …)`. Two-layer state + controlled props already work. |
| Checkbox / select / textarea matrix | **Medium** | Event choice (`input` vs `change`), `checked` vs `value`, static `type` detection, select multiple. |
| Record field paths (`checked={ todo.completed }`) | **Medium–hard** | `update()` not assign; no types; validation throws; store thrash on free-text fields. |
| Nested plain objects (`value={ form.email }`) | **Hard** | Needs path-aware setData or immutable nested write convention. |
| Number / date coercion, file, radio group | **Medium** | Type-attr driven; groups need shared state. |
| Coexistence with author `@input` | **Medium** | Composition order + opt-out policy. |
| Component prop two-way | **Hard / separate** | Bindable props + child write protocol. |
| Schema-derived forms helper | **Separate feature** | Already paired on the backlog with bind sugar; depends on bind first. |

**Bottom line:** the 80% case that kills todos glue is **not that hard** — on the order of other v1.x template amendments (event modifiers, refs). The full “Ember Data forms” story is a multi-phase program.

---

## 8. Recommended product design

### The rule (natural, no new syntax)

On **form-control elements only**, certain dynamic attrs are **two-way when the expression is an assignable lvalue**:

```html
<!-- two-way -->
<input value={ newTodoText } />
<textarea value={ body }></textarea>
<select value={ selectedId }>...</select>
<input type="checkbox" checked={ accepted } />

<!-- still one-way: not an lvalue -->
<input value={ newTodoText.trim() } />
<input value={ props.label } />
<input value={ count + 1 } />
```

**No** `value:bind`, **no** `bind:value`, **no** `v-model` as the required path.

### Scope for phase 1 (ship first)

- Elements: `input`, `textarea`, `select` (single)
- Attrs: `value` (text-like inputs, textarea, select), `checked` (checkbox)
- Expressions: **bare identifiers only** → `this.setData(name, next)`
- Events: `input` for text-like value; `change` for checkbox and select

### Explicitly out of phase 1

- Record / member paths (`todo.completed`)
- Nested local objects (`form.email`)
- `input type="file"`
- Radio groups
- `select multiple` (phase 1.5 candidate)
- Number/range coercion (keep strings in phase 1; coerce later)
- Contenteditable (rejected forever for true two-way — D44; use islands)
- Component tags
- Media element bindings

### Mental model for authors

> On form controls, `value={ name }` and `checked={ name }` keep the field and local state in sync when `name` is a simple data field. If the expression is not a simple field (a call, operator, etc.), you get display-only control and write the handler yourself — same as today.

---

## 9. Assignable lvalue rules

### Bindable (phase 1)

1. **Bare identifier** — `newTodoText`  
   - Must not be a JS keyword/literal/global that `resolveExpr` leaves unprefixed in a misleading way (same tables as expr.go).  
   - Write: `this.setData('newTodoText', next)`  
   - Read side stays `value: __d.newTodoText` (or scope var if somehow in scope — bare data fields are the common case).

### Bindable (phase 2+)

2. **Member chain of simple identifiers** — `todo.completed`, `row.draft`  
   - No calls, no computed keys (`todo[k]`), no optional chaining in v1 of the parser (optional: support `todo?.x` as non-bindable).  
   - Write via runtime helper (record `update` vs nested assign policy).

### Not bindable → one-way only

- Calls: `fmt(x)`, `x.trim()`, `String(x)`
- Operators: `a + b`, `!done`, `a ? b : c`, `a ?? ''`
- Literals, globals
- Anything the lvalue classifier cannot parse as a pure path

### Opt-out without special syntax

Use a non-lvalue:

```html
<input value={ String(displayOnly) } />
<input value={ draft ?? '' } />
```

That is enough for phase 1. A future explicit one-way marker is optional and should not be required.

### Dev warning (recommended)

In development builds, when a form control has `value`/`checked` with a non-lvalue dynamic expression, warn once per site:

> `[puzzle] value={ … } on <input> is display-only (expression is not assignable). Add an @input handler or bind a bare data field for two-way.`

Optional, low cost, prevents “I thought this was two-way” confusion.

---

## 10. Element / attribute / event matrix

| Element | Attr | Event (auto) | Read | Write type (phase 1) |
|---|---|---|---|---|
| `input` text-like (text, search, email, password, url, tel, …) | `value` | `input` | `el.value` | string |
| `input type="number"` / `range` | `value` | `input` | `el.value` (phase 1) | string; coerce later |
| `input type="checkbox"` | `checked` | `change` | `el.checked` | boolean |
| `input type="radio"` | — | — | — | **out** (needs group) |
| `input type="file"` | — | — | — | **out** |
| `textarea` | `value` | `input` | `el.value` | string |
| `select` (single) | `value` | `change` | `el.value` | string |
| `select multiple` | `value` | `change` | selected values | string[] (phase 1.5) |

**Static `type` detection:** when choosing checkbox vs text behavior, prefer a static `type="checkbox"` attribute. If `type={ dynamic }`, conservative policy:

- Prefer skip auto-bind + dev warning, **or**
- Treat as text `value`+`input` (wrong for checkbox — worse)

Recommend: **static type only**; dynamic type → no auto-bind + warn.

**`disabled` / `readonly` / other attrs:** never two-way. They are one-way controlled or static.

---

## 11. Write-target resolution (local vs store)

Puzzle has no reactive `let`. Writes go through existing owners:

| Target | Write | Phase |
|---|---|---|
| Data-root bare id (`newTodoText`) | `this.setData(name, next)` | 1 |
| Scope root that is a record (`todo.completed`) | `todo.update({ completed: next })` | 2 |
| Nested local object (`form.email`) | path-aware setData or whole-object replace | 3 |

### Phase 1 emission (direct, no helper)

```js
// conceptual emitted listener for value={ newTodoText }
(event) => {
  this.setData('newTodoText', event.target.value);
}
```

```js
// conceptual for checked={ accepted }
(event) => {
  this.setData('accepted', event.target.checked);
}
```

Cache with D62 when the key is fixed (always, for bare id).

### Phase 2 runtime helper (conceptual)

```js
// client-runtime helper; imported only when a member-path bind is emitted
export function __bindWrite(root, key, next) {
  if (root != null && typeof root.update === 'function') {
    root.update({ [key]: next });
    return;
  }
  // plain object: mutate + ? how to notify parent local state
  // defer until path-aware setData exists
  root[key] = next;
}
```

Compiler cannot prove `todo` is a model; duck-typing `update` matches PuzzleModel’s public API.

### Validation hazard (phase 2)

`PuzzleModel.update()` validates schema-declared fields in the patch and **throws** `PuzzleValidationError` before assign. Mid-keystroke binding into constrained fields is hostile.

Options:

1. **Local draft + commit on submit** (recommended default for free text) — bind local, copy into `record.update` on save.
2. **Fail-soft bind path** — assign + notify without full validate (new API; careful).
3. **Catch and surface** — swallow throw, set local error state (forms helper territory).

Recommendation: phase 2 documents that **schema-strict free-text fields should bind local drafts**; checkboxes/enums that always validate are fine on `update`.

---

## 12. Composition with author handlers

### Recommended policy

1. **Always** install the auto-write when the attr is bindable.
2. If the author also wrote `@input` / `@change` for the same event, **compose**:
   - **Auto-write first**, then author handler.
   - Lets the author log, validate, or transform *after* the raw write (including a second `setData` with a cleaned value).
3. Do **not** treat author `@input` as opt-out of auto-bind (that makes “add logging” break binding).

### Composition order rationale

| Order | Transform case `setData(name, e.target.value.toUpperCase())` |
|---|---|
| Auto then author | Author wins with uppercase — **good** |
| Author then auto (Svelte-like) | Auto overwrites with raw — **bad for transforms** |

Svelte runs author first then bind because assignment is the bind’s job and authors usually don’t double-write. Puzzle’s auto-write *is* a setData; authors who also setData need the last write to win → **author after auto**.

### Implementation options for composition

**A. Codegen merges into one listener** (preferred for phase 1):

```js
'@input': ((this.__h ??= {})[n] ??= (event) => {
  this.setData('newTodoText', event.target.value);
  this.events.afterType?.(event); // only if author had @input
})
```

**B. Runtime double-listener** on the same event name — messier with patch/swap semantics in ViewManager.

Prefer **A**.

### If author uses a different event

```html
<input value={ q } @change={ onCommit(event) } />
```

Auto still adds `@input` writeback (keystroke sync). `@change` remains the author’s commit hook. This is a mild behavior change vs today if someone relied on `value={ q }` being display-only until change — call out in release notes. Escape: non-lvalue expression.

---

## 13. Two-layer state interaction

`#recompose` builds `{ ...#local, ...#model }`.

Implications for bound local fields:

1. Seed in `created()` via `setData({ newTodoText: '' })`.
2. Auto-bind writes update `#local` and visible `#data` immediately and re-render.
3. On store-driven `data()` commit:
   - If `data()` **omits** `newTodoText`, local value **remains** (only in `#local`, still composed).
   - If `data()` **returns** `newTodoText: localData.newTodoText`, same value, fine.
   - If `data()` **returns a constant** `newTodoText: ''`, model **wins** and wipes typing on every store refresh — **author bug**; document it.

**Glue removal beyond the handler:** after auto-bind, `data()` no longer needs to re-export pure local draft fields. That is an extra win for the todos pattern.

Filters that feed derived lists still need `setData` + `refresh()` (or put the filter in a place that re-runs data) — binding doesn’t invent derived-state tracking like Svelte `$:`.

---

## 14. Ember Data magic — what auto-bind does and doesn’t buy

| Layer | Auto after this feature? |
|---|---|
| Input → local field | **Yes** (phase 1) |
| Input → record field | **Yes** (phase 2, with caveats) |
| Record field → store subscribers / re-render | **Already yes** (`update` → notify) |
| Record → adapter / server | **No** — still `save()` / write-sync |
| Schema → labels / errors / dirty / field widgets | **No** — forms helper (separate) |
| Domain actions (submit create, destroy, toggle with invariants) | **No** — still `events` |

Auto-bind removes **template glue**. It does not remove **domain actions**. That is the right split. Ember’s magic was observable models + two-way helpers, not “every keystroke hits the network.”

The backlog item “two-way bind sugar **plus** a schema-derived forms helper” should stay **two cards**: bind first (substrate), forms helper later (product layer on top).

---

## 15. Before / after: todos

### Before (today)

```html
<input
  value={ newTodoText }
  @input={ updateNewTodoText(event) }
/>
```

```js
created() {
  this.setData({ newTodoText: '', currentFilter: 'all' });
}
data() {
  const localData = this.getData();
  return {
    todos, activeTodos, completedTodos, filteredTodos,
    newTodoText: localData.newTodoText,
    currentFilter: localData.currentFilter,
  };
}
events = {
  updateNewTodoText: (event) => {
    this.setData('newTodoText', event.target.value);
  },
  addTodo: (event) => {
    event.preventDefault();
    const text = this.getData().newTodoText.trim();
    if (text) {
      this.ctx.store.createRecord('todo', { text });
      this.setData('newTodoText', '');
    }
  },
  // ...
};
```

### After (phase 1)

```html
<input value={ newTodoText } />
```

```js
created() {
  this.setData({ newTodoText: '', currentFilter: 'all' });
}
data() {
  // newTodoText can stay local-only; optional to re-export
  const localData = this.getData();
  return {
    todos, activeTodos, completedTodos, filteredTodos,
    currentFilter: localData.currentFilter,
  };
}
events = {
  // updateNewTodoText gone
  addTodo: (event) => {
    event.preventDefault();
    const text = this.getData().newTodoText.trim();
    if (text) {
      this.ctx.store.createRecord('todo', { text });
      this.setData('newTodoText', '');
    }
  },
};
```

### Phase 2 sketch for checkbox (optional; tradeoffs)

```html
<input type="checkbox" checked={ todo.completed } />
```

vs keeping domain method:

```html
<input type="checkbox" checked={ todo.completed } @change={ toggle } />
```

Domain methods with side effects / invariants should stay explicit. Auto-bind is best when the write *is* the field assignment.

---

## 16. Implementation phases

### Phase 0 — Decision + SPEC truthing (before code)

New constellation decision card, e.g. **D### — Natural form binding**:

- Form-control `value`/`checked` on assignable lvalues are two-way by default.
- No new primary syntax.
- Non-lvalues stay one-way.
- Composition order (auto then author).
- Element matrix and phase boundaries.
- Rewrite stale SPEC §6 “two-way on inputs” into the real contract (was fiction; becomes true for the defined matrix).
- Update glossary, template syntax, events guide, `plan.md` backlog line.
- One decision card, forever; no superseding chain (per project rules).

### Phase 1 — Local bare-identifier binding (**ship this first**)

**Compiler:**

1. In `emitAttrs` / `attrKV` (or a pre-pass over element attrs), for tags `input` | `textarea` | `select` (not components):
   - Detect bindable `value` / `checked` `DynamicAttr` with bare-ident expr.
   - For checkbox: require static `type="checkbox"` and bind `checked`; for others bind `value`.
   - Emit property as today.
   - Emit synthetic write listener (merged with author listener if present).
2. Lvalue classifier unit tests next to `expr.go` / `expr_test.go`.
3. Goldens: new `bind-local` fixture; update todos compiled fixtures when examples change.
4. Handler cache: synthetic bare-key setData is cacheable.

**Runtime:**

- Prefer **codegen-only** for phase 1 — emit ordinary `@input`/`@change` handlers. No ViewManager change required.
- Optional later: shared read helper for coercion.

**Examples / scaffold / docs:**

- `examples/todos`, scaffold todos template, blog comment form, stress FormState.
- README, USER_GUIDE, TEMPLATE_SYNTAX, EVENTS, agent skill surface if it teaches forms.

**Tests:** see [§20](#20-test-plan).

### Phase 1.5 — Select multiple + number coercion (optional)

- `select multiple` → array of selected values.
- `type="number"|"range"` → number | empty policy (lock product choice first).

### Phase 2 — Record / member paths

- Lvalue parser for `a.b.c`.
- Runtime `__bindWrite` / duck-typed `update`.
- Validation-on-keystroke decision.
- Docs: when to use local draft vs direct record bind.
- TodoItem checkbox optional simplification.

### Phase 3 — Nested local paths + path-aware setData

Only if real apps need `form.email` drafts:

```js
setData('form.email', v) // deep-write into #local.form, recompose
```

or encourage flat keys / whole-object replace in an explicit handler until demand is proven.

### Phase 4 — Schema-derived forms helper (separate feature)

Generate field widgets / error surfaces from model schema. Bind is the substrate; keep decoupled.

---

## 17. Codegen sketch (phase 1)

### Input sketch

Template:

```html
<input value={ newTodoText } />
```

Today (one-way):

```js
new ViewNode('input', {
  value: __d.newTodoText
}, [])
```

After phase 1:

```js
new ViewNode('input', {
  value: __d.newTodoText,
  '@input': ((this.__h ??= {})[0] ??= (event) => {
    this.setData('newTodoText', event.target.value);
  })
}, [])
```

### With author handler

Template:

```html
<input value={ newTodoText } @input={ afterType(event) } />
```

Emitted (conceptual):

```js
'@input': ((this.__h ??= {})[0] ??= (event) => {
  this.setData('newTodoText', event.target.value);
  this.events.afterType(event);
})
```

### Checkbox

Template:

```html
<input type="checkbox" checked={ accepted } />
```

Emitted:

```js
{
  type: 'checkbox',
  checked: __d.accepted,
  '@change': ((this.__h ??= {})[0] ??= (event) => {
    this.setData('accepted', event.target.checked);
  })
}
```

### Non-lvalue (unchanged one-way)

```html
<input value={ newTodoText.trim() } />
```

```js
{ value: __d.newTodoText.trim() }  // no writeback
```

### Implementation notes for Go

- Add `isAssignableLvalue(expr string) (path []string, ok bool)` — phase 1: single bare ident only.
- When emitting an element, collect attr list, detect bind candidates, detect existing EventAttr for the bind event name, merge or append.
- Do not double-emit if somehow both `value` and `checked` bind (checkbox should only bind `checked`).
- Component tags (`isComponent`): **never** auto-bind (props are one-way; D16).
- Respect existing `startsWithObjectLiteral` / expression error paths.

---

## 18. SPEC / API contract sketch

Phase 1 contract language (for the decision card / SPEC §6):

```
On <input>, <textarea>, and <select> (not on component tags):

  value={ Ident }
    → controlled `value` property
    → auto writeback on `input` (text-like, textarea) or `change` (select)
    → write: this.setData('Ident', event.target.value)

  checked={ Ident } on <input type="checkbox">
    → controlled `checked` property
    → auto writeback on `change`
    → write: this.setData('Ident', event.target.checked)

  value={ <non-lvalue> } / checked={ <non-lvalue> }
    → controlled one-way only (no writeback)

  Author @input / @change for the same event compose AFTER the auto-write.

  disabled, readonly, and all other attributes are never two-way.

  Dynamic type={…} on input: no auto-bind (dev warning).

Out of this contract (later or never):
  file inputs, radio groups, contenteditable, component props,
  member-path / record binding (phase 2), nested path setData (phase 3).
```

**Release / semver note:** this is a **behavior change** for templates that used assignable `value={ x }` as display-only with a delayed write. Treat as minor (0.5.x / 0.6.0) with release-notes callout, not a silent patch.

---

## 19. Risks and edge cases

| Risk | Mitigation |
|---|---|
| Cursor jump on re-render | Already mitigated (live property compare). Keep tests. |
| IME composition | Browsers usually fire `input` reasonably; `compositionend` later if needed. Don’t block v1. |
| `data()` wiping local bound keys | Document: omit bound local keys from `data()` return, or re-read local. Never return a constant for a bound key. |
| Store thrash (phase 2 free-text on records) | Prefer local drafts for free text; direct bind for checkboxes/enums. |
| Validation throws mid-type (phase 2) | Fail-soft policy or local draft only for constrained fields. |
| SSG / static / hybrid | Writeback is browser-only; prerender serializes controlled value as today. |
| Handler cache identity | Bare-key setData is data-independent → cacheable. Member paths with loop vars are **not** cacheable (same as today for loop-captured handlers). |
| Surprise two-way | Docs lead with the rule; optional dev warning on non-lvalue. |
| Stale SPEC “two-way” fiction | Rewrite in the same decision that implements it — or rewrite *before* code to “planned” then to “shipped.” |
| `@change`-only controlled inputs | Auto `@input` starts keystroke updates; escape via non-lvalue; release notes. |
| Author transform order | Auto then author (locked). |
| Checkbox without static type | No auto-bind + warn. |
| `value` on non-form elements (`<li value>`, `<progress>`) | Do not auto-bind; only form-control tags. |
| Double setData with identical value | setData always schedules render today — acceptable; optional future equality short-circuit is unrelated. |
| HMR / devstate | Local layer already snapshotted; bound fields are normal local keys. |

---

## 20. Test plan

### Go (compiler)

- Lvalue classifier tables: bare ok; `a.b` phase-2; calls/ops reject.
- Golden: bare `value={ x }` emits `@input` setData.
- Golden: `checked` + static checkbox emits `@change` setData.
- Golden: `value={ x.trim() }` emits no writeback.
- Golden: author `@input` merges (auto then author).
- Golden: component tag `<Foo value={ x } />` does **not** auto-bind.
- Golden: dynamic `type={ t }` no auto-bind (or documented fallback).
- Existing goldens stay byte-identical where templates have no bindable form attrs.

### Vitest (runtime / integration)

- Type into input **without** author `@input` → `getData().field` updates.
- Re-render preserves caret (existing controlled path).
- Submit / button reads bound field.
- `setData` clear after submit updates input display.
- Author `@input` still fires after auto-write; can transform.
- Non-lvalue remains one-way (typing does not update state without handler).
- Checkbox toggles local boolean.
- Select changes local string.
- Store refresh does not wipe local-only bound field.
- `data()` returning constant for bound key *does* wipe (document via test if useful as regression of author footgun).

### Example cleanup

- todos: remove `updateNewTodoText`; keep behavior.
- blog comment form: same pattern.
- stress FormState: exercise bound vs one-way cases.
- Scaffold templates: ship the short form so `puzzle init` demos the magic.

### Suites before “done”

```bash
npx vitest run
cd compiler && go test ./...
```

Plus focused goldens / example smoke as appropriate.

---

## 21. Docs / constellation work

| Artifact | Change |
|---|---|
| New `DECISION-D###-NATURAL-FORM-BINDING` | Source of truth for the design |
| `DOC-SPEC-TEMPLATE` §6 | Replace fictional “two-way on inputs” with the real matrix + phases |
| `DOC-GLOSSARY` controlled property | Two-way when assignable lvalue on form controls |
| `DOC-TEMPLATE-SYNTAX` | Rewrite “Controlled form values” section; show glue-free examples |
| `DOC-EVENTS` | setData still the write owner; auto-bind emits it for you |
| `DOC-USER-GUIDE` | Update comment-form prose |
| `DOC-RELEASE-SURFACE` | When shipped |
| `plan.md` backlog | Move bind sugar to scheduled/shipped; keep forms helper separate |
| `README.md` | Show `<input value={ q } />` without handler |
| Agent skill (`skills/puzzle` / embed) | Teach the default; avoid re-teaching manual glue as the only way |
| Parser `DynamicAttr` comment | Align with real semantics |
| Feature card | `FEATURE-…` for the ship train when built |

Per project rules: SPEC change requires a decision card; rewrite in place if a card already owns the question (there isn’t a real one yet — create new). Don’t leave fiction.

---

## 22. Effort estimate

| Phase | Rough effort | Ships user value? |
|---|---|---|
| Decision + SPEC truthing | 0.5–1 day | Clarity |
| Phase 1 local bare-id | ~2–4 focused days (compiler + tests + examples + docs) | **Yes — kills most form glue** |
| Phase 1.5 select multiple / number | ~1–2 days | Nice |
| Phase 2 records | ~3–5 days + validation policy | Checkboxes on rows, etc. |
| Phase 3 nested path setData | 2–3 days | Only if demanded |
| Schema forms helper | Separate project (week+) | Ember-Data-like forms UX |

Not a multi-month architecture rewrite. Design risk is mostly **rules**, not code volume.

---

## 23. Open product choices

Lock these in the decision card before coding:

| # | Choice | Recommendation |
|---|---|---|
| 1 | Record binding in v1 or phase 2? | **Phase 2** |
| 2 | Dev warning on non-lvalue form value/checked? | **Yes**, once per site in dev |
| 3 | Number input empty value: `''` / `null` / `undefined`? | **Strings only in phase 1**; coerce later |
| 4 | `@change`-only controlled inputs behavior change | Accept in minor; release notes; non-lvalue escape |
| 5 | Composition order | **Auto-write then author** |
| 6 | Dynamic `type={…}` | **No auto-bind + warn** |
| 7 | Explicit `bind:` escape hatch later? | Optional; **not** required for default |
| 8 | Should `data()` re-export of local bound fields remain the style guide? | Optional either way; prefer “local-only keys need not be re-exported” |

---

## 24. Recommendation

**Do it. Prefer natural bare `value={ x }` over Svelte-style `bind:` as the primary surface.**

Why Puzzle is a good fit:

1. Controlled property patching is already correct.
2. `setData` is already the cheap keystroke path (no `data()` re-run).
3. Two-layer state already preserves local fields across store refreshes.
4. The compiler already owns expression rewrite and event emission — desugaring here matches refs, modifiers, and handler caching.

**Ship phase 1 first** (local bare identifiers on input/textarea/select). That alone turns:

```html
<input value={ newTodoText } @input={ updateNewTodoText(event) } />
```

into:

```html
<input value={ newTodoText } />
```

**Hold phase 2 (records)** until phase 1 is real and validation-on-keystroke is decided.

**Do not** require `value:bind` / `bind:value` for the default case. Explicit sugar can be a later escape hatch; it must not be the only way.

---

## 25. Suggested next steps

1. Author the constellation decision card with the phase-1 contract above.
2. Truth SPEC §6 / glossary / template docs as the decision is written (or immediately after), not weeks later.
3. Implement phase 1 as a narrow compiler desugar + goldens + todos/scaffold cleanup.
4. Run both suites; update examples and agent skill.
5. Park record binding + schema forms as follow-up cards linked from `plan.md`.
6. Only then consider path-aware setData if apps demand nested drafts.

---

## 26. Code & doc map (for implementers)

### Compiler

| Path | Role |
|---|---|
| `compiler/internal/parser/ast.go` | `DynamicAttr`, `EventAttr` |
| `compiler/internal/parser/parser.go` | attr parsing |
| `compiler/internal/codegen/codegen.go` | `emitElement`, `emitAttrs`, `attrKV` |
| `compiler/internal/codegen/expr.go` | `resolveExpr`, keywords/globals tables — add lvalue helper nearby |
| `compiler/internal/codegen/testdata/*.pzl` + `*.golden.js` | golden fixtures |
| `compiler/internal/scaffold/templates/todos/` | scaffolded todos (embed — ships with binary) |

### Runtime

| Path | Role |
|---|---|
| `client-runtime/views/viewManager.js` | controlled props, listeners, select re-assert |
| `client-runtime/views/PuzzleView.js` | `setData`, two-layer state, render schedule |
| `client-runtime/model.js` | `PuzzleModel.update`, validation throws |
| `client-runtime/datastore/store.js` | `recordChanged`, subscriptions |

### Examples / tests

| Path | Role |
|---|---|
| `examples/todos/app/views/Home.pzl` | canonical glue today |
| `examples/todos/app/components/TodoItem.pzl` | checkbox via callbacks |
| `examples/blog/app/views/PostDetail.pzl` | comment form one-way + handlers |
| `examples/stress/app/scenarios/FormState.pzl` | form stress cases |
| `tests/helpers/todos-suite.js` | types into input via synthetic `input` events |
| `tests/fixtures/todos/Home.compiled.js` | compiled fixture |

### Docs / constellation

| Path | Role |
|---|---|
| `constellation/doc/DOC-SPEC-TEMPLATE.md` | §6 bindings claim (stale) |
| `constellation/doc/DOC-TEMPLATE-SYNTAX.md` | controlled form values (truthful one-way) |
| `constellation/doc/DOC-GLOSSARY.md` | controlled property definition |
| `constellation/doc/DOC-EVENTS.md` | setData patterns |
| `constellation/plan.md` | backlog: bind sugar + forms helper |
| `constellation/decision/DECISION-D44-DOM-ISLANDS.md` | contenteditable rejected |
| `constellation/feature/FEATURE-V1-32-RELEASE-HARDENING.md` | “binding forms unsupported” language (expression boundary) |

---

## 27. Appendix: framework research notes

### Svelte bind surface (reference matrix)

Useful as a checklist for *later* phases, not phase 1 scope:

- `bind:value` on input/textarea/select
- `bind:checked`, `bind:indeterminate` on checkbox
- `bind:group` for radio and checkbox groups
- `bind:files` for file inputs
- number/range coercion; empty → `undefined`
- `bind:open` on details
- media: currentTime, paused, volume, …
- contenteditable: innerHTML / innerText / textContent (Svelte offers these; Puzzle correctly rejects analogous controlled contenteditable — use islands)
- readonly dimension bindings via ResizeObserver
- `bind:this` for element/component refs (Puzzle has `ref="name"` instead)
- component `bind:prop` + `$bindable`
- function bindings `{ get, set }`

### Ember lessons

- Two-way without DDAU becomes hard to reason about across components.
- Mutating properties of passed-in objects is a footgun (looks like arg mutation).
- Built-in Input helper two-way is convenient and also a Classic trap in Octane apps.
- **Take for Puzzle:** keep auto-bind on **DOM form controls** writing **local state or record fields**, not on component props, in v1–v2.

### Vue lessons

- Type-specific desugar is necessary for checkboxes/selects.
- Component v-model is a separate protocol — don’t conflate with DOM bind.
- **Take for Puzzle:** phase 1 matrix by tag/type; leave component bind for a later decision.

### Angular lessons

- Banana box is still *explicit* sugar over one-way + event.
- Reactive forms show that large apps often want one-way + form controller objects.
- **Take for Puzzle:** auto-bind is for the fast path; complex forms can still use explicit handlers or a future forms helper.

### Why not just copy Svelte’s `bind:`?

Svelte’s explicit directive is safer as a *language* design (opt-in, greppable, teachable). Puzzle’s product taste is Ember-like magic on form controls. Given:

- form controls are a closed tag set,
- lvalue rules prevent binding into expressions,
- non-lvalue remains one-way,
- component tags are excluded,

…the surprise surface is bounded. The benefit is matching the author’s desired DX: **no special syntax for the common case**.

If surprise becomes a real problem in the wild, an *optional* explicit one-way marker or bind marker can be added later without removing the default.

---

## Closing

Two-way form binding is the kind of feature that makes a framework feel like magic when it works, and like a trap when the rules are fuzzy. Puzzle is in a good place to ship the magic **narrowly**:

- form controls only,
- assignable bare fields first,
- compiler desugar into the state APIs we already trust,
- records and schema-forms as deliberate follow-ons.

Phase 1 is the slice that deletes `updateNewTodoText` and makes `puzzle init` demos feel like Ember without bringing back Classic’s component two-way muddle.

---

*End of note. Implementation should start from §16 Phase 0–1 and §18 contract, not from the full matrix.*
