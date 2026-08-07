# Puzzle Implicit Two-Way Form Binding Plan

Date: 2026-07-28

## Recommendation

Implement automatic write-back for writable expressions on native form controls:

```html
<input value={ newTodoText } />
<input type="checkbox" checked={ todo.completed } />
<textarea value={ profile.notes }></textarea>
<select value={ profile.status }>...</select>
```

That is the complete author-facing API. Puzzle should not introduce a `bind`
attribute, directive, helper, modifier, prefix, or alternate component.

This is a medium-sized compiler/runtime feature, not a reactivity rewrite.
Puzzle already implements the state-to-DOM half:

- dynamic `value` and `checked` attributes compile normally;
- the DOM patcher assigns controlled properties;
- live DOM drift is corrected on later renders;
- matching values are not rewritten, preserving the caret;
- store updates already notify subscribed views.

The missing half is compiler-inferred DOM-to-state write-back. The work is
concentrated in code generation, a small internal `PuzzleView` write surface,
ViewManager listener management, and tests/docs. No public syntax needs to
change, so editor grammars and formatters should remain unaffected.

## Why this fits Puzzle

Puzzle's frozen template contract already says:

> `value={ var }` (two-way on inputs)

That appears in `constellation/doc/DOC-SPEC-TEMPLATE.md` §6. The current
implementation and detailed docs disagree with it: the runtime only controls
the DOM property, examples manually mirror values with `@input`/`@change`, and
the glossary says Puzzle does not infer assignment.

This should therefore be treated as closing a contract/implementation gap.
Before implementation, add a numbered decision clarifying the exact semantics
and update the frozen contract. Do not frame the feature as new `bind` sugar;
the natural dynamic attribute is the feature.

## Framework research

### Ember

Modern Ember provides capitalized built-in `<Input>` and `<Textarea>`
components. Unlike native lowercase elements, those components automatically
update their bound values. It supports `@value` for text controls and
`@checked` for checkboxes, while allowing ordinary event actions alongside the
automatic update.

Ember Data complements that model by allowing direct record-field assignment,
tracking dirty attributes, and persisting later through `save()`.

Puzzle should copy the convenience, not Ember's spelling:

- keep native lowercase `<input>`, `<textarea>`, and `<select>`;
- infer write-back from `value={writableExpression}` or
  `checked={writableExpression}`;
- route record writes through Puzzle's existing `record.update()` contract;
- do not add capitalized wrapper components or an author-visible binding word.

Sources:

- [Ember built-in form components](https://guides.emberjs.com/release/components/built-in-components/)
- [Ember Data record updates and dirty tracking](https://guides.emberjs.com/release/models/creating-updating-and-deleting-records/)

### Svelte

Svelte makes binding explicit, which is not the desired Puzzle API, but its
behavior is a useful reference:

- only writable lvalues can receive updates;
- a compiler-generated listener performs write-back;
- authored same-event handlers run before automatic write-back;
- number/range controls produce numbers, with empty/invalid numeric input
  becoming `undefined`;
- checkbox state comes from `checked`;
- radio groups and multi-select controls require distinct collection/group
  semantics.

Puzzle should borrow those behavioral rules while omitting Svelte's `bind:`
syntax.

Source:

- [Svelte binding documentation](https://svelte.dev/docs/svelte/bind)

## Locked product decisions

These decisions were confirmed during planning:

1. There is no public `bind` spelling anywhere.
2. Plain native form attributes opt in automatically when their expression is
   writable.
3. An authored handler and automatic write-back both run.
4. The authored handler runs first; automatic write-back reads the control's
   final live value afterward.
5. PuzzleModel fields continue to use strict `record.update()` validation.
6. No Ember-style dirty-record redesign is part of this feature.

## Public behavior

### Supported controls in the first release

| Template form | DOM event | Value written |
| --- | --- | --- |
| `<input value={ target }>` for text-like, color, date/time, and other ordinary value inputs | `input` | `element.value` |
| `<input type="number" value={ target }>` | `input` | `element.valueAsNumber`, or `undefined` when empty/invalid |
| `<input type="range" value={ target }>` | `input` | `element.valueAsNumber`, or `undefined` when invalid |
| `<textarea value={ target }>` | `input` | `element.value` |
| `<select value={ target }>` | `change` | selected option's string value |
| `<input type="checkbox" checked={ target }>` | `change` | `element.checked` |

The compiler should only infer behavior when `type` is absent or a static
string it can classify safely. A dynamically computed input `type` remains a
normal one-way dynamic attribute.

### Writable target forms

The first release should recognize exactly:

```html
value={ localName }
value={ record.field }
checked={ todo.completed }
```

- A bare render-data identifier writes with `this.setData(name, value)`.
- A one-level member whose receiver is a `PuzzleModel` writes with
  `record.update({ [field]: value })`.
- A one-level member on a plain object assigns `object[field] = value` and
  schedules the owning view to render.
- A loop item may be the receiver, so `todo.completed` and `row.text` work.
- A bare loop variable/counter is not writable because Puzzle cannot replace
  its source collection entry from the variable alone.

The compiler must not infer write-back for:

- calls, operators, ternaries, formatters, or other computed expressions;
- optional chaining;
- computed keys such as `record[field]`;
- deeper paths such as `record.settings.theme` in the first release;
- static/mixed values such as `value="hello"` or `value="Hello {name}"`.

Those forms retain today's one-way dynamic-attribute behavior without a
warning. Puzzle cannot know whether the author intended a read-only projection,
so making them errors would break valid templates.

This also provides the escape hatch for intentionally controlled/manual input:

```html
<input value={ formatName(name) } @input={ customUpdate(event) } />
```

There is still no separate opt-out directive.

### Explicit handler ordering

For:

```html
<input
  value={ profile.name }
  @input={ normalizeName(event) } />
```

the event turn is:

1. Puzzle captures the control and schedules its inferred write.
2. Every authored `@input` handler runs normally, including modifiers.
3. Puzzle reads the control's final live value.
4. Puzzle writes that value to `profile.name`.

The automatic step should occur in a microtask after the native event dispatch
but before the next paint/event. This gives every authored handler first access
regardless of listener reattachment order. A transform handler can change
`event.currentTarget.value`; the inferred write then stores the transformed
value.

This ordering also keeps existing checkbox toggles from reversing themselves:
an authored handler may update the record first, then the inferred write stores
the checkbox's already-final boolean.

### Model and validation behavior

PuzzleModel writes must call the real `record.update()` method. This preserves:

- schema validation;
- primary-key immutability;
- record revision tracking;
- store notifications and persistence scheduling;
- model identity and computed getters.

If `record.update()` rejects a keystroke with `PuzzleValidationError`, the
record stays unchanged under the existing atomic validation contract. The
inferred writer must schedule a corrective owner render in `finally`, allowing
the controlled DOM property to converge back to the accepted record value.
The error must not be silently converted into a dirty record.

This means per-keystroke record binding is best for fields whose intermediate
values are valid. A field with rules such as `required().min(3)` cannot accept
the intermediate one- and two-character values directly. That use case still
needs view-local draft state followed by explicit validation/commit. A future
forms/draft feature can address that without changing this binding syntax.

### Reactivity after member writes

After a member write, schedule the view that owns the control to render even
when the target is a PuzzleModel.

This is required because Puzzle records mutate in place. A record passed as a
component prop remains reference-equal, so the parent's store refresh can hit
the child's shallow-prop bailout. The owner render keeps the control and any
derived labels in that component current. Store notifications still refresh
every genuinely subscribed view.

Existing render scheduling should coalesce this with store-driven refreshes;
the implementation must test that one edit does not cause a redundant second
paint.

## Deliberate first-release exclusions

Do not infer write-back for:

- radio inputs;
- checkbox groups;
- `<select multiple>`;
- file inputs;
- `contenteditable`;
- component props such as `<CustomInput value={name}>`;
- `disabled`, `selected`, `indeterminate`, or arbitrary dynamic attributes;
- nested model-object paths;
- form-reset synchronization or default-value semantics.

Radio/checkbox groups and multi-select need collection semantics, not a scalar
property copy. File inputs expose `FileList` and cannot be controlled like
strings. Contenteditable is DOM-tree state, not a flat value. Each deserves a
separate decision rather than hidden inference.

Component props must remain one-way. Inferring parent mutation from a
capitalized component's `value` prop would violate Puzzle's current
props/callback model and make ordinary component APIs surprising.

## Compiler design

### 1. Keep the parser grammar unchanged

`name={expression}` already parses as `DynamicAttr`. Do not add a new AST node
or syntax token. Update the AST comment/docs that currently mention two-way
behavior, but keep parsing byte-compatible.

### 2. Add a narrow write-target classifier to codegen

During element emission, inspect the complete element:

- verify that the tag is a supported lowercase native control;
- locate the eligible `value` or `checked` dynamic attribute;
- inspect static `type`/`multiple` attributes;
- classify the trimmed expression as a bare data identifier or one-level
  member target;
- reject loop counters, globals, computed expressions, and unsupported paths
  from inference while still emitting their ordinary dynamic value.

This is a small lexical classifier, not a JavaScript parser. It must reuse the
existing identifier/scope rules so it does not weaken the contract that Go
never parses or rewrites the user's script body.

### 3. Emit one private write descriptor

Keep emitting the normal controlled property:

```js
value: __d.newTodoText
```

For an eligible target, append one reserved, compiler-only vnode attribute
after authored attributes. Conceptually:

```js
'@input:__puzzleWrite': {
  read: 'value',
  write: this.__writeLocal('newTodoText')
}
```

or:

```js
'@change:__puzzleWrite': {
  read: 'checked',
  write: this.__writeMember(__d.todo, 'completed')
}
```

The exact private name is not public API, but it should avoid the word `bind`
so generated output and internal documentation remain consistent with the
framework vocabulary.

The descriptor must be emitted after normal attrs so generated output is
deterministic. It must never be emitted for component tags or unsupported
targets.

### 4. Preserve stable identities

Add per-view caches for:

- local writers keyed by local field name;
- member writers keyed by object identity plus field name.

Repeated renders should return the same writer function while the target
identity is unchanged. This follows Puzzle's existing cached-handler rule and
prevents every keystroke from rebinding native listeners across a large form.

## Runtime design

### PuzzleView internal writer surface

Add compiler-facing, underscore-prefixed methods that are not public API:

- `__writeLocal(name)` returns a cached function calling `setData(name, value)`.
- `__writeMember(target, field)` returns a cached function that:
  - calls `target.update({ [field]: value })` for a PuzzleModel;
  - otherwise assigns the plain-object field;
  - schedules the owner render;
  - schedules corrective convergence even when a strict model update throws.

Use `instanceof PuzzleModel`, not an `update` duck-type check; ordinary objects
may legitimately define unrelated `update` methods.

### ViewManager write listener

Treat the reserved descriptor as a framework directive:

- it is never written as a DOM attribute;
- attach one capture-phase listener for its native event;
- keep the native listener stable and update its current descriptor in an
  element-owned cell during patches;
- snapshot the control and descriptor at event time;
- perform the read/write in a microtask after authored handlers;
- run the write through the owner's committed-route scope fence;
- remove the listener and cell during attr removal, replacement, aborted mount,
  and subtree teardown.

Reader behavior:

- `value` reads `element.value`;
- `number` reads `valueAsNumber` and maps `NaN` to `undefined`;
- `checked` reads `Boolean(element.checked)`;
- `select` reads the selected scalar string.

Do not create an independent form-state subsystem. The listener is only the
missing path into existing `setData()` or `record.update()`.

### Patcher and caret behavior

Retain the existing controlled-property rules:

- compare input/textarea `value` against the live DOM before assigning;
- compare checkbox `checked` against the live DOM;
- reassert select value after option children settle;
- skip the write when the state already equals the live property.

After an accepted keystroke, the next render should therefore perform no DOM
value mutation and preserve selection/caret position.

### Static and hybrid output

The private descriptor begins with `@`, so the SSG serializer should omit it
like every event listener. Initial controlled values continue to serialize as:

- input `value`;
- textarea text content;
- selected option state;
- boolean `checked`.

Hybrid takeover and static-page mounting then attach the inferred listeners
through the normal browser mount path. No serialized function or hydration
protocol is needed.

Inside a DOM `island`, inferred listeners follow the existing island rule:
they are wired from the seed tree at mount and their captured target remains
frozen because island children never patch.

## Compatibility and migration

This is intentionally a behavior change for existing writable form
expressions. It should ship in a minor release with explicit upgrade notes.

Existing patterns:

```html
<input value={ name } @input={ updateName(event) } />
```

will run both paths. Applications should:

- remove handlers that only copy `event.target.value` or `.checked`;
- keep handlers that perform real side effects;
- make transform handlers update `event.currentTarget.value` before returning
  so the inferred write stores the transformed value;
- use a non-writable display expression and fully manual handler when automatic
  assignment is not desired.

Repository migrations should include:

- canonical todos and the todos scaffold;
- typed todos;
- the `examples/binding` datastore demonstration;
- blog/comment, chat/composer, music, canvas, orrery, stress, and other examples
  found by auditing writable `value={...}` / `checked={...}` controls;
- generated/handwritten todos integration fixtures;
- README, user guide, template syntax, events, models/datastore docs, glossary,
  release surface, and embedded Puzzle skill.

The stress form-state scenario needs special treatment. It currently uses
handler-free controlled fields to measure one-way patching. Either make those
expressions intentionally non-writable to preserve that benchmark or redefine
the scenario to measure inferred-listener cost; do not silently change what its
numbers mean.

## Constellation/spec work before code

1. Add `DECISION-D147-IMPLICIT-FORM-WRITEBACK` to define:
   - no public binding syntax;
   - eligible controls and targets;
   - handler-before-write ordering;
   - local/object/PuzzleModel destinations;
   - numeric coercion and strict validation;
   - excluded radio/group/file/contenteditable/component cases.
2. Add a planned `FEATURE-IMPLICIT-FORM-WRITEBACK` card connected to the
   decision, template spec, codegen, PuzzleView, ViewManager, PuzzleModel,
   reactivity flow, SSG, and todos integration test.
3. Amend `DOC-SPEC-TEMPLATE` §6 with the full behavior. This is required because
   the frozen spec currently promises two-way input behavior without defining
   it.
4. Reconcile the contradictory detailed docs and glossary.
5. Replace the roadmap's deferred “two-way bind sugar” item with the remaining
   genuinely deferred forms/draft/group work.
6. Keep cards `planned` until implementation exists, then move through
   `building` → `built` → `verified`.

## Test plan

### Compiler tests

- Bare local `value={name}` emits the normal value plus private writer.
- Model and loop members emit member writers.
- Text, number, range, textarea, checkbox, and select choose the correct event
  and reader.
- Explicit same-event handlers remain present beside inferred write-back.
- The private descriptor appears after authored attrs.
- Components, radio/file inputs, dynamic input types, multi-selects, deep or
  computed paths, formatters, calls, and static/mixed values emit no writer.
- Bare loop items/counters emit no writer.
- Existing dynamic-attribute output outside form controls remains unchanged.
- Generated JavaScript passes syntax validation and focused golden tests.

### Runtime unit tests

- Typing updates a local data key without an authored handler.
- Programmatic `setData()` still updates the control.
- Textarea and select round-trip in both directions.
- Checkbox clicks write booleans.
- Number/range write numbers; empty/invalid number writes `undefined`.
- A PuzzleModel member calls real `update()`, not direct assignment.
- Store subscribers and a record-as-prop owner both display the new value.
- Plain-object members update and rerender their owner.
- Authored handler runs exactly once and before automatic write-back.
- A handler that rewrites the live control value changes what is stored.
- Strict validation leaves the record unchanged and converges the DOM back.
- Primary-key mutation remains rejected.
- Accepted writes do not rewrite an already-equal live value or move the caret.
- Generated listeners do not churn across ordinary rerenders.
- Listener teardown covers removal, keyed replacement, unmount, and aborted
  render/mount paths.
- Route-state fencing still exposes committed params/route during write-back.

### SSG/static tests

- Private writer descriptors never appear in HTML.
- Input, textarea, select, and checked initial state serialize identically.
- Hybrid takeover activates implicit write-back.
- True static-page mounting activates implicit write-back without a router.

### Integration and migration tests

- The canonical todos app adds text and toggles a record with no mirror-only
  `@input`/`@change` handler.
- Both handwritten-fixture and freshly compiled todos lanes pass the same suite.
- The binding example proves datastore → input and input → datastore across
  text, numeric, color, and textarea controls.
- Persistence round-trip still observes inferred record writes.
- The scaffolded todos source compiles and behaves like the canonical example.

### Required verification

Run at minimum:

```sh
npx vitest run
cd compiler && go test ./...
```

Also run:

```sh
npm run test:types
npm run lint:examples
npm run build
```

Then build/smoke the canonical todos, binding, typed-todos, stress, hybrid, and
static examples. Re-read every touched card against the final code, run
Constellation integrity/sync checks, and only then mark the feature verified.

## Acceptance criteria

The feature is done when all of these are true:

1. This works without any event handler:

   ```html
   <input value={ newTodoText } />
   ```

   Typing updates `newTodoText`, and changing `newTodoText` updates the input.

2. This writes through the datastore:

   ```html
   <input value={ profile.displayName } />
   ```

   Typing calls the equivalent of
   `profile.update({ displayName: nextValue })`; every subscribed projection
   updates and persistence sees the change.

3. This writes a boolean:

   ```html
   <input type="checkbox" checked={ todo.completed } />
   ```

4. Authored same-event handlers run before write-back and are not suppressed.
5. No public documentation or example requires or recommends a binding word.
6. Non-writable expressions and unsupported controls preserve one-way behavior.
7. No private writer metadata reaches prerendered HTML.
8. Existing controlled-value and caret-preservation tests remain green.
9. Both required full test suites pass.

## Main risks

### Existing handlers now perform duplicate work

The selected “both run” policy is convenient for side effects but makes this a
real behavior change. The repository-wide example audit and clear migration
notes are mandatory.

### Strict validation is hostile to some per-keystroke fields

This is the cost of preserving Puzzle's current `record.update()` contract.
Do not quietly invent dirty model state inside this feature. Document local
drafts as the answer until a separate forms decision exists.

### Record-as-prop identity can hide updates

The inferred member writer must explicitly schedule its owning view. Relying
only on store subscription propagation will leave some child projections stale.

### Listener ordering can regress after patches

Do not depend on `addEventListener` insertion order. The capture-plus-microtask
design makes authored-handler-before-write a semantic guarantee across listener
replacement and modifier combinations.

### Over-inference can make ordinary attributes surprising

Keep the first classifier narrow: native controls, known property, simple
writable target. Expand radio/group/multiple/nested-path behavior only through
later explicit decisions and tests.

