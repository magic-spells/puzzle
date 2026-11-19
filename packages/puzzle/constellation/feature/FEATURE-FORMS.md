---
name: Forms module (@magic-spells/puzzle/forms)
status: built
connections:
  - DECISION-D192-FORMS-MODULE
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D48-SCHEMA-VALIDATION
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-PUZZLE-MODEL
change: feature
code_refs:
  - client-runtime/forms.js
  - types/forms.d.ts
  - tests/forms.test.js
  - tests/fixtures/forms/PostForm.pzl
  - examples/blog/app/views/PostDetail.pzl
---

# Forms module

An opt-in subpath that turns a model schema into a working form: a draft that
may hold invalid input, per-field touched / changed / errors, a submitting flag,
server-error mapping and reset. Rationale: [[DECISION-D192-FORMS-MODULE]].

## Example

```html
<puzzle-view>
  <!-- focusout bubbles, so one handler on the form marks whichever field was left -->
  <form @submit={ save(event) } @focusout={ touch(event) } novalidate>
    <label for="title">Title</label>
    <input id="title" name="title" value={ form.values.title } />
    {#if form.errors.title}<p class="error">{ form.errors.title }</p>{/if}

    <!-- or, with the Field piece -->
    <Field form={ form } name="body" label="Body" />

    {#if form.error}<p class="error">{ form.error }</p>{/if}
    <button type="submit" disabled={ form.submitting || !form.dirty }>Save</button>
    <button type="button" @click={ cancel }>Cancel</button>
  </form>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import { createForm } from '@magic-spells/puzzle/forms';
import Post from '../models/post.js';

export default class EditPost extends PuzzleView {
  created() {
    this.form = createForm(this, Post, { from: this.props.post, fields: ['title', 'body'] });
  }

  events = {
    save: (event) => this.form.submit(event, (values) => this.props.post.update(values).save()),
    touch: (event) => this.form.touch(event),
    cancel: () => this.form.reset(),
  };
}
</script>
```

## API

`createForm(view, Model, options?)` → controller, also written to the view's state.

| Option | Meaning |
|---|---|
| `from` | Record or plain object that seeds the draft. Omitted: `Model.applyDefaults({})`. |
| `fields` | Field names the form edits and validates. Omitted: every schema field. |
| `key` | View state key the controller is written to. Default `'form'`. |
| `serverErrors(err)` | Returns `{ field: message }` for an error `fn` threw; replaces the built-in mapping. |

| Controller member | Meaning |
|---|---|
| `values` | Draft, one accessor per field; bind it directly. |
| `errors` | Visible error per field: first model message, shown once touched or after a submit attempt, or a server message. |
| `touched` | `true` per field after blur (`touch(name)`) or a submit attempt. |
| `changed` | `true` per field whose value differs from the baseline. |
| `dirty` / `valid` / `submitting` | Any field changed / every field passes / `fn` is in flight. |
| `error` | Form-level message from a server error that maps to no field, else `null`. |
| `set(name, value)` | Write one field (what a bind's setter calls). |
| `touch(nameOrEvent)` | Mark a field touched and validate it. Takes a name, or a focus event whose `target.name` is a form field (so one `@focusout` on the `<form>` covers every control). |
| `submit(event?, fn)` | Validate, then await `fn(values)`; resolves `true` on success, `false` when invalid, already submitting, or `fn` threw. |
| `reset(from?)` | Back to the baseline, or reseed from a new source; clears touched and errors. |

## Behavior notes

- **Re-render, and `data()` only when it reads the form.** Changes call
  `view.setState(key, controller)`, which schedules a render. `data()` re-runs
  only if its last run read that key (D23), so a value derived from the draft
  stays current without a `refresh()`.
- **Records loaded later.** When the record arrives after `created()`, reseed
  once it exists: `afterUpdate() { const { post } = this.getData(); if (post && this.form.source !== post) this.form.reset(post); }`.
- **After success** the baseline becomes the submitted values, so `dirty` goes
  false; touched clears.
- **Invalid submit** focuses the first invalid control found by `name` in the
  submitted form's `elements`.
- **Destroyed view.** Writes after the view is destroyed are dropped (the
  `setState` guard).
- **Dev hot reload** builds a fresh form; an unsaved draft does not survive it.
- **Name the import `createForm`.** Importing it as `form` shadows the state
  key: the template would read the (undefined-in-templates) import.
- **Example app:** the blog's comment form (`examples/blog`,
  `PostDetail.pzl`) uses it with the comment model's rules.

## Field piece

`<Field form={ form } name="title" label="Title"/>` reads `form.values[name]`,
shows `form.errors[name]` (an explicit `error` prop still wins), writes through
`form.set(name, value)` and touches on blur. Templates can't call a controller
method directly (handlers are the one door, D176 §7), which is why raw inputs
go through one `touch` handler and Field does it internally. Field duck-types the controller
and imports nothing, so apps without the module are unchanged.

## Not included

Field arrays and nested objects as fields, async or debounced per-field
validators, cross-field rules beyond what a model's `validate(fn)` already
expresses, schema-less forms (a Model is required), multi-step wizards, file
inputs, value parsers/formatters, autosave, and form-level dirty-route guards.
