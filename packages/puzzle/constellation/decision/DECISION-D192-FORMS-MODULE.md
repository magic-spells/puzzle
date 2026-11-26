---
name: D192 — an optional /forms module holds a form's draft, touched, changed, errors and submitting state
status: verified
connections:
  - FEATURE-FORMS
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D191-SET-STATE-GET-STATE
  - DECISION-D23-REFRESH-PATTERN
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D145-ERROR-BOUNDARIES
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-PUZZLE-MODEL
  - DOC-RELEASE-SURFACE
code_refs:
  - client-runtime/forms.js
  - types/forms.d.ts
  - compiler/internal/codegen/binding.go
  - tests/forms.test.js
verified_at: '2026-11-24T18:05:31.213Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

## Context

Puzzle has the parts of a form but no form. Two-way binding (D147) writes a
control back to state or to a record, `Model.validate(data, { fields })`
returns `{ valid, errors }`, and the Field piece shows one error string. A
record path can't hold invalid input (`update()` throws before mutating, so a
`required()` field can never be emptied through a bind), so every real form
binds a local draft and validates on submit. Every app then hand-rolls the same
bookkeeping around that draft: an error key per field, which fields the user
has visited, which differ from the saved record, a submitting flag that blocks
a double submit, mapping a server's 422 back onto fields, and reset. The 1.0
readiness review ranks this first among missing features (A3).

## Decision

Ship it as an opt-in subpath, `@magic-spells/puzzle/forms`, exporting one
function. An app that never imports it pays nothing.

```js
import { createForm } from '@magic-spells/puzzle/forms';

created() {
  this.form = createForm(this, Post, { from: this.props.post, fields: ['title', 'body'] });
}
```

- **One controller, kept in view state.** `createForm()` builds the controller and
  writes it to the view with `setState(key, controller)` (`key` defaults to
  `'form'`), so the template reads `form.values.title` with nothing else to
  wire. Every change writes the same key again, which schedules one re-render;
  `data()` re-runs only when it read that key ([[DECISION-D23-REFRESH-PATTERN]]),
  so a `data()` that derives from the draft stays current with no `refresh()`. A second form in one view passes its own `key`.
- **Draft values.** `values` holds one property per form field, seeded from
  `from` (a record or plain object) or, without one, from
  `Model.applyDefaults({})`. It is a stable object whose properties are
  accessors, so a D147 bind (`value={ form.values.title }`) writes through the
  setter and the form sees every edit. The draft may hold anything; nothing is
  checked until the user leaves a field or submits.
- **Validation is the model's.** The form calls
  `Model.validate(values, { fields })` and keeps the first message per field.
  It adds no rule syntax of its own.
- **Errors appear late and clear early.** `errors` holds only what the user
  should see: a field's error shows once that field is `touched` (the user
  left it, or a submit attempt touched every field), and from then on it
  re-checks on every edit, so it clears the moment the input is fixed. `valid`
  covers every field regardless.
- **`changed` and `dirty`** compare each value to its baseline (dates by time).
  The baseline is `from` at creation, and the values a successful submit sent,
  so a field edited while the save ran stays changed.
- **`submit(event, fn)`** prevents the default, marks every field touched,
  validates, and stops (focusing the first invalid control) when invalid.
  Otherwise it sets `submitting`, awaits `fn(values)` with a plain copy, and
  resolves `true`. A second submit while one is pending resolves `false` at
  once.
- **Server errors map onto fields.** When `fn` throws, a
  `PuzzleValidationError` maps by its `errors[].field`; a `PuzzleAdapterError`
  whose body carries `errors` as `{ field: message | [message] }` or
  `[{ field, message }]` maps the same way. Anything that maps to no field
  becomes the form-level `error` string and reaches the app's `onError` with
  `phase: 'submit'`. A field's server error clears when that field is edited.
  `options.serverErrors(err)` replaces the mapping for other API shapes.
- **`reset(from?)`** restores the baseline (or reseeds from a new source) and
  clears touched, errors and the form-level error.
- **Re-rendering children.** The controller carries the D170 render revision
  and bumps it on every change, so `<Field form={ form } name="title"/>`
  re-renders through the existing `propsEqual` revision check.
- **D147 binds deeper member paths.** Binding accepts `a.b.c` (any depth of
  plain, non-computed, non-optional steps), emitted as
  `this.__bind(__d.a?.b ?? 0, 'c', spec)`. `form.values.title` is three steps,
  and a nested plain object (`user.address.city`) is the same case. The runtime
  is unchanged: the third arm already writes any plain object.

## Alternatives rejected

- **Flat state keys** (`values.title`, `errors.title`, `submitting` as
  separate view keys). Binds within today's two-step limit, but two forms in
  one view collide and the names fight a view's own state.
- **A Proxy for `values`.** Catches unknown keys too, but `structuredClone`
  (the HMR snapshot path) throws on a Proxy. Accessors over a known field list
  clone and serialize as plain data.
- **Naming the export `form`.** It reads well (`this.form = form(...)`), but a
  name the script imports is undefined in the template, and the compiler warns
  when a template reads one, so every template's `form.values` would trip the
  warning against the default state key. `createForm` leaves `form` free.
- **A `<Form>` component or form directives in the grammar.** New syntax for
  something a function and the existing bind already cover.
- **Validating every keystroke from the first one.** Flags an email field as
  invalid while the user is still typing it.
- **Rethrowing `fn`'s error from `submit()`.** Handlers are fire-and-forget,
  so a rethrow becomes an unhandled rejection; the error goes to `onError`
  instead.

## Consequences

- New subpath export, alias in the build's runtime table, `types/forms.d.ts`
  and a drift entry. The module is about 1.3 KB gzip, and only an app that
  imports it ships it.
- D147's trigger rule (`ident` or `ident.ident`) is rewritten in place to allow
  deeper plain paths; its "display-only paths write back" gotcha covers more
  shapes.
- The controller is a class instance, so the HMR state snapshot (plain data
  only) drops it: after a dev hot reload `created()` builds a fresh form and an
  unsaved draft is lost. Production is unaffected.
- The `onError` phase set gains `submit` ([[DECISION-D145-ERROR-BOUNDARIES]]).
- The Field piece accepts `form` + `name` (duck-typed, no import), so it works
  with or without the module.
- Removes "a schema-derived forms helper" from plan.md's unscheduled ideas.
