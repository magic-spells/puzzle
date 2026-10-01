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
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D167-COMPONENT-FAMILIES
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - FLOW-REACTIVITY
  - DOC-SPEC-TEMPLATE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/viewManager.js
  - compiler/internal/codegen/binding.go
---

# D147 — implicit two-way form binding

## Context

`value={ draft }` reads state into a form control, but nothing writes the
user's edit back; a one-line mirror `@input` handler was the most repeated glue
in Puzzle apps. The grammar has no attribute namespaces
([[DECISION-D85-FLIP-ATTRIBUTE]]) and `.pzl` scripts are opaque to Go, so the
answer has to be decidable from the template alone.

## Decision

The compiler synthesizes the write-back handler — zero new syntax. A classifier
in `compiler/internal/codegen/binding.go` inspects the element; the runtime
supplies one memoized dispatcher, `PuzzleView.__bind`. `viewManager.js`'s
controlled props, caret-safe live-DOM compare (`syncControl`) and
`reassertSelectValue` carry the rest.

### Trigger — all must hold

1. Tag is a plain `<input>`, `<textarea>` or `<select>` — never a component
   (component `value` is a plain prop, [[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]).
2. The `value`/`checked` attr name is spelled exactly (lowercase: the runtime's
   controlled-prop lookup is case-sensitive) and its expression is exactly
   `ident` or `ident.ident`. Literals, calls, operators, computed or optional
   steps and deeper paths (`a.b.c`) never classify. A bare `{#for}` variable
   doesn't classify; a loop variable as the root of a member path
   (`todo.completed`) does.
3. No author `@input` or `@change` (any modifiers) — the author owns the write.
   Other events (`@keydown:enter`, `@blur`) do not suppress.
4. No static `readonly` or `disabled`; no `<select multiple>`.
5. `type` absent or a static string the matrix covers; dynamic or valueless
   `type` never binds. `checked` binds only on static `type="checkbox"`.

Anything else compiles as a one-way binding, silently. Escapes are existing
syntax: write your own handler, use a non-path expression
(`value={ x ?? '' }`), or add static `readonly`.

### Matrix

| Control | Event | Write | Spec |
|---|---|---|---|
| `<input>` no type, or text/search/email/password/url/tel/color | `input` | string | `v` |
| `type="number"` | `change` | `'' → null`; `Number(v)`; NaN skips | `vn` |
| `type="range"` | `input` | `Number(v)`; NaN skips | `vn` |
| `type="checkbox"` (`checked=`) | `change` | boolean | `c` |
| date/time/month/week/datetime-local | `change` | string | `v` |
| `<textarea>` | `input` | string | `v` |
| `<select>` (single) | `change` | string | `v` |

Other input types (file, radio, submit, button, reset, image, hidden) never
bind. Number commits on `change` because coercion breaks the caret round-trip
(`"1.20"` → `1.2` would rewrite the field mid-typing); date kinds yield `''`
mid-entry. `''` writes `null` so a cleared field isn't rewritten to `"0"`;
`Number('-')` is NaN and would render `"NaN"`, so it is skipped.

### Emission

A render-time call under a distinct listener key, riding the modifier channel:

```js
'@input:bind': this.__bind(null, 'draft', 'v')              // local state
'@change:bind': this.__bind(s.item ?? 0, 'completed', 'c')  // {#for} member (D170 row item)
'@change:bind': this.__bind(__d.profile ?? 0, 'hue', 'vn')  // data-root member
```

It consumes no `__h` handler-site index ([[DECISION-D62-HANDLER-CACHING]]).
Inside a lowered `{#for}` the target is `s.item`, the row's current record at
write time, so a bind after a reorder writes the live record. The `?? 0`
coalesce keeps a missing root inert instead of falling into the local arm.

### Runtime

`__bind` memoizes on (target, key, spec) — Map for locals, WeakMap-of-Maps for
member targets — so listener identity is stable across renders
([[DECISION-D18-PER-NODE-LISTENERS]]). A primitive root (`value={ title.length }`)
returns a shared inert handler. The handler returns early on
`event.isComposing`, coerces, then writes:

- **Local** (`null`): `setData` + `refresh()` — so a bound filter feeding
  `data()` narrows as you type ([[DECISION-D23-REFRESH-PATTERN]]).
- **Record** (duck-typed `update` + string `_type`): strict
  `record.update({ [key]: v })`. Validation is never bypassed
  ([[DECISION-D48-SCHEMA-VALIDATION]]); `update()` throws before mutating, so a
  rejected write changes nothing and reports through
  [[DECISION-D145-ERROR-BOUNDARIES]] with `phase: 'bind'`.
- **Plain object**: `target[key] = v` + `refresh()`. A throwing assign (frozen
  `route.query`, getter-only) reports `phase: 'bind'` and stops.

The write-back refresh routes sync throws and async rejections into the D145
funnel (`phase: 'bind'`). A cached clean `{#for}` row skips `patchAttrs`, so the
row block re-asserts its collected control vnodes through the same
`syncControl` compare.

### Gotchas

- **Layer clobber** — `#recompose` composes model over local, so binding a bare
  key that `data()` also derives is reverted next commit. Bind the path you want
  written (`value={ profile.name }` for records, bare `value={ draft }` for
  drafts). A dev-only diagnostic warns once per key when a recompose reverts a
  bound local.
- **Rebuilt member root** — `data() { return { form: { name: '' } } }` returns a
  new object each run, so every keystroke is erased. Dev-only diagnostic (armed
  on the write, checked at the end of the next render; fires only when the old
  object vanished and exactly one replacement lacks the value). Fix: a stable
  object (`this.memo(...)`), a record, or a bare local.
- **Constrained fields** — a `required()` field can't be cleared via bind; bind
  a local draft and commit on submit, using `record.validate()` for form UX.
- **IME** — only the write side is guarded. A re-render from elsewhere
  mid-composition still re-asserts the stale value into the composing element;
  a patch-side guard is not implemented.
- **Islands** — a bind inside a [[DECISION-D44-DOM-ISLANDS]] subtree attaches at
  mount and survives the freeze.
- **Upgrade audit** — a handler-less path-shaped `value=` that was display-only,
  or paired only with key/blur handlers, now writes back. Edit buffers need a
  non-path expression (`examples/music` Playlist rename uses
  `playlist.name ?? ''`). Compile and grep for `__bind(`.

Out of scope: radio groups, `<select multiple>`, file inputs,
`contenteditable`, component-prop binding, deeper paths, debounce/lazy
modifiers, dirty tracking.

## Alternatives

- `bind:value` / directive namespace — re-opens D85. Attribute namespaces are a
  positioned parse error (except `xml`/`xlink`/`xmlns`, event attrs exempt);
  directive-shaped halves (`bind`, `model`, `v-model`, `sync`, `value`,
  `checked`) get a message teaching the keyword-free form, other prefixes are
  steered to stripping or `{#svg}`.
- A `bind` marker word or `bind={{ … }}` — new grammar for what the classifier
  infers.
- A framework `<Input>` component — no attr forwarding; collides with native
  element names ([[DECISION-D167-COMPONENT-FAMILIES]]).
- Lowering to `__d.x = v` — `getData()` is a copy; writes are lost.
- Running the author handler and the auto-write — double writes stomp clamping
  handlers.
- Warning on non-classifying expressions — spam on legitimate display bindings.

## Consequences

- Controls with an author `@input`/`@change` compile byte-identically; adopting
  the feature means deleting the mirror handler.
- The `:bind` suffix is greppable and visible in DevTools listener listings.
- SSG output strips `@` attrs, so prerendered markup carries only the initial
  value; hydration and `mountStatic` attach listeners on mount.
