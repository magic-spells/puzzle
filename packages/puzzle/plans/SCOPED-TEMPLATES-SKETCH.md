# Scoped templates — design sketch

**Status: APPROVED — targeting 0.7.0. The binding implementation spec is
`SCOPED-TEMPLATES-PLAN.md` (D166); where the two disagree, the plan wins
(notably: the cross-file fit-check is a dev-mode runtime warning, not a
compile error). This file remains the syntax rationale record (Cory + Fable,
2026-08-30).**

## The one-line framing

Slots render a passed-in template; scoped templates render it **repeatedly,
with data**. Nothing conceptually new: today's slots render the caller's
template exactly once with no arguments — this feature lifts both
restrictions and changes nothing else. (Open the decision card and the docs
with this sentence.)

## Why

A component that owns its loop (virtual list, sortable table, combobox
dropdown, tree) cannot let the caller customize what one item looks like.
Shipping proof: pieces `data-table` renders every cell as
`<td …>{ cell.value }</td>` (DataTable.pzl:66) — plain text, hardcoded. No
app can put a badge, avatar, link, or button in a cell. Same wall in
combobox, tree, command, multi-select, and any future virtualized list
piece. The benefit lands almost entirely on pieces; app-internal components
rarely need it (you own the code — the existing idiom of looping on the page
over a one-item component covers plain lists).

## Syntax

### Component side (extends existing markers — no new marker)

Attributes on `<Children>` / `<Slot name="x">` hand data out per stamp:

```html
{#for user in users}
  <li key={ user.id }>
    <Children user={ user }>{ user.name }</Children>
  </li>
{/for}

<Slot name="row" user={ user } group={ group }>fallback…</Slot>
```

Paired bodies stay fallbacks (D141 unchanged): rendered when no template
fills the position — so every existing caller keeps working.

### Caller side (one new marker: `<Template>`)

```html
<UserList users={ users }>
  <Template user>
    <img src={ user.avatar } /> { user.name }
  </Template>
</UserList>

<GroupedList groups={ groups }>
  <Template fits="heading" group>{ group.title }</Template>
  <Template fits="row" user group index>…</Template>
</GroupedList>
```

Rules:

- `fits="x"` routes the template to `<Slot name="x">`. Omit `fits` → the
  template fills the default `<Children>` position. ("Fits" is deliberate:
  fitting implies shape-matching, which is literally the compile-time check —
  and it lands the Puzzle brand metaphor. It also earns a distinct word from
  the shipped `slot="x"` attribute: that is static markup *placed into* a
  slot; a Template is a parameterized thing that must *fit* one.)
- On `<Template>`, **`fits` takes a value and nothing else does.** Every
  bare attribute is a parameter declaration. Bare-attribute params were
  chosen over `data={ user, other }` because `={ }` everywhere else in
  Puzzle means "evaluate and pass IN" — using it for received names lies
  about flow direction (the exact hack-feel of Vue's `v-slot="{ user }"`).
  Bare attrs pass visibly nothing, which is what a declaration is; precedent:
  `island`, `flip`.
- A valued attribute other than `fits` on `<Template>` is a positioned
  compile error steering to the bare form (same steering style as lowercase
  `<slot>` → `<Slot>`, D134). Reserved-word collision is only `fits` itself
  (a slot handing over a variable literally named `fits` — ~never).
- Binding is **by name**, not position: the marker's attribute names feed the
  template's declared parameter names. Declaring a subset of what the slot
  offers is legal.
- Lowercase `<template>` (the HTML element) stays unambiguous via the D134
  capitalization rule.

### Compile errors in the product metaphor

```
Team.pzl:12:3: template fits slot "row", but "row" hands over `user` —
this template declares `person`. The shapes don't match.
```

Typos are caught twice at compile time: undeclared identifiers in the body
(static scoping, like `{#for}` variables), and the fit-check at the tag.

## Mechanics

- **All wiring is compile time.** A caller's body already compiles to a
  render chunk (how `<Children/>` works today — e.g. SlideOver). A Template
  is that chunk **with parameters**. Sketch of emitted code:
  `row: (user, group) => [ …vnodes… ]` on the caller;
  `this.templates.row ? this.templates.row(user, group) : fallbackVnodes`
  at the marker. The syntax mirrors the output — templates are just props
  (the model already says @event bindings are callback props: everything a
  caller gives a component is a prop — values, callbacks, templates).
- **Runtime cost is small and gated.** Repeated stamping rides existing
  keyed reconciliation (each marker sits at a keyed position in the
  component's own loop). New runtime work: pass marker args into the chunk,
  re-render a stamp when its args change. Estimate a few hundred bytes gzip.
  Gate it behind the D89 usage scan (`__PUZZLE_HAS_SCOPED_TEMPLATES__`-style
  define, same as flip/Portal/lazy — see PR #87): apps that never use it pay
  zero.
- No browser template parsing, ever — invariant unchanged.

## Rejected spellings (keep in the decision card)

- Svelte-4 `let:user` / Vue `v-slot="{ user }"` — function parameters in
  attribute costume; declaration far from use; Svelte 5 itself deprecated
  `let:` for declared snippets.
- Block form `{#template row(user)}…{/template}` — mechanically identical,
  function-flavored; loses to the marker form on markup-readability and on
  fitting the existing capitalized-marker family.
- `data={ user, other }` param bundle — passing syntax spelling a receive.
- `name=` as the routing attribute — reserves `name`, a plausible parameter.

## Open questions for the decision card

- Change-detection rule for re-stamping (re-run chunk per parent render vs
  arg diff).
- Interaction with `<Portal>` and `island`.
- Can a Template's body use the caller's own scope alongside its params
  (presumably yes — closure over caller scope, like Children today)?
  Shadowing rules when a param name collides with a caller variable
  (presumably param shadows, like `{#for}`).
- Multiple Templates fitting the same slot name = compile error?
  (presumably yes, positioned.)
- `puzzle check` (D165) coverage: type the params from the slot's handed
  expressions where declared types exist.
- First customer and acceptance case: pieces `data-table` cell templates
  (header-cell + cell), then combobox option rows.
