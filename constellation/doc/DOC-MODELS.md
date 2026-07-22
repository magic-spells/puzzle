---
name: MODELS.md — models & schema builders
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-SPEC
  - DOC-DATASTORE
  - DOC-ROUTER
---

The Puzzle.* field-builder API (types + all modifiers with an enforced-in-v1 column), plain-getter computed properties, instance methods calling this.update(), the model registry, and the record lifecycle. The acceptance spec for [[COMPONENT-PUZZLE-MODEL]].

# Puzzle Models & Schema Builders

Part of the Puzzle docs — see [[DOC-SPEC]] for the frozen v1 contract.

Models define the shape of your data: what fields exist, their types, their defaults, and their validation rules (enforced at the local write boundary since v1.16 — see [v1 enforcement semantics](#v1-enforcement-semantics) below). Every model is a plain JavaScript class that extends `PuzzleModel` and declares its fields with the `Puzzle` schema builders. Records returned by the store are **instances of your model class**, so computed getters and instance methods work everywhere a record is read — including templates.

This document covers the full v1 model surface: defining models, the complete builder API, computed properties, instance methods, the model registry, and the record lifecycle.

---

## Defining a Model

A model lives in `/models` and exports a class with a `static schema`:

```js
// models/todo.js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date())
  };
}
```

Three rules to remember:

1. **`Puzzle` builders are the only documented way to define fields.** Raw descriptor objects are an internal format — don't write them by hand.
2. **The class is the record.** `store.createRecord('todo', { text: 'Ship v1' })` returns an instance of `Todo`, so anything you put on the class (getters, methods) is available on every record.
3. **Schemas are declarative.** The store reads `static schema` to apply defaults and identify the primary key — your class body stays plain JavaScript.

---

## Schema Builder Reference

### Types

| Builder | Field type |
| ------- | ---------- |
| `Puzzle.string()` | String |
| `Puzzle.number()` | Number |
| `Puzzle.boolean()` | Boolean |
| `Puzzle.date()` | Date |
| `Puzzle.array()` | Array |
| `Puzzle.object()` | Object |

### Modifiers (chainable)

Every modifier returns the builder, so they chain: `Puzzle.string().required().min(1, '...')`.

| Modifier | Meaning | Enforced in v1? |
| -------- | ------- | --------------- |
| `.primary()` | Marks the primary key; implies required. | ✅ Honored by the store |
| `.required(message?)` | Field must be present (fails on `undefined`, `null`, `''`). | ✅ Enforced (v1.16) |
| `.default(value \| () => value)` | Applied on `createRecord` when the field is absent. Pass a function for per-record values (fresh dates, generated ids). Object/array literals are deep-cloned per record (SPEC §35) — `.default([])` gives each record its own array, never a shared reference. | ✅ Honored by the store |
| `.min(n, message?)` | Minimum — length for strings/arrays, value for numbers/dates. | ✅ Enforced (v1.16) |
| `.max(n, message?)` | Maximum — length for strings/arrays, value for numbers/dates. | ✅ Enforced (v1.16) |
| `.oneOf([...], message?)` | Enum constraint — value must be strictly (`===`) one of the listed options. | ✅ Enforced (v1.16) |
| `.validate(fn, message?)` | Custom rule escape hatch — `fn(value)` returns truthy for valid. | ✅ Enforced (v1.16) |

The optional `message` argument on validation modifiers is the human-readable error shown when the rule fails; omit it and a default message naming the field and the bound is used (see [v1 enforcement semantics](#v1-enforcement-semantics) below).

### Default values: static vs function

```js
static schema = {
  completed: Puzzle.boolean().default(false),          // same value for every record
  createdAt: Puzzle.date().default(() => new Date()),  // evaluated per record at createRecord time
  tags:      Puzzle.array().default(() => []),         // ⚠ always use a function for arrays/objects
};
```

Always use the function form for arrays and objects so each record gets its own instance rather than a shared reference.

---

## Worked Examples

### The canonical todo schema

This is the real schema from the todos example app ([examples/todos/app/models/todo.js](../examples/todos/app/models/todo.js)):

```js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date())
  };
}
```

### A richer example: User

A model that exercises more of the builder surface — custom messages, `.validate()`, `.oneOf()`, and number fields:

```js
// models/user.js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class User extends PuzzleModel {
  static schema = {
    id: Puzzle.number().primary(),
    firstName: Puzzle.string()
      .required('First name is required.')
      .min(2, 'First name must be at least 2 characters'),
    lastName: Puzzle.string().required('Last name is required.'),
    email: Puzzle.string()
      .required('Email is required.')
      .validate((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Please enter a valid email'),
    avatar: Puzzle.string(),
    joinedAt: Puzzle.date(),
    isActive: Puzzle.boolean().default(true),
    role: Puzzle.string().default('user').oneOf(['user', 'admin'], 'Unknown role'),
  };

  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  }

  get initials() {
    return `${this.firstName[0]}${this.lastName[0]}`.toUpperCase();
  }

  get isAdmin() {
    return this.role === 'admin';
  }
}
```

---

## Computed Properties

Computed properties are **plain JavaScript getters** on the model class. There is no `computedProperties` map and no registration step — if it's a getter on the class, it works anywhere a record is read, including templates.

From the real todo model:

```js
export default class Todo extends PuzzleModel {
  static schema = { /* ... */ };

  get isActive() {
    return !this.completed;
  }

  get formattedDate() {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(this.createdAt);
  }
}
```

Used directly in a template:

```html
{#for todo in todos}
  <span>{ todo.text }</span>
  <small>{ todo.formattedDate }</small>
{/for}
```

Or in a component's `data()`:

```js
data(params, props) {
  const todos = this.ctx.store.findMany('todo');
  return {
    todos,
    activeTodos: todos.filter(t => t.isActive),
  };
}
```

Getters recompute on every read, so they always reflect the record's current field values. Keep them cheap — heavy filtering/sorting belongs in `data()` or a `findMany` query, not a getter.

---

## Instance Methods

Records are instances of your class, so business logic belongs on the model as ordinary methods. Inside a method, `this` is the record — read fields directly and mutate through `this.update()`.

The toggle/markComplete pattern from the todo model:

```js
export default class Todo extends PuzzleModel {
  static schema = { /* ... */ };

  toggle() {
    return this.update({
      completed: !this.completed,
      updatedAt: new Date()
    });
  }

  markComplete() {
    if (!this.completed) {
      return this.update({
        completed: true,
        updatedAt: new Date()
      });
    }
    return this;
  }

  markIncomplete() {
    if (this.completed) {
      return this.update({
        completed: false,
        updatedAt: new Date()
      });
    }
    return this;
  }
}
```

Two things to note:

- **`update()` returns the record**, so model methods that call it can `return this.update(...)` and callers can chain or inspect the result.
- **`update()` notifies subscribers.** Any component whose `data()` queried this record re-runs automatically — the calling component doesn't need to do anything else.

Calling from a component's event handler is a one-liner:

```js
events = {
  toggleTodo: (todo) => { todo.toggle(); },
};
```

```html
<input type="checkbox" checked={ todo.completed } @change={ toggleTodo(todo) } />
```

---

## The Model Registry

Models are registered by name in `models/index.js` and handed to `PuzzleApp`. The key you register under is the type string you pass to store methods.

```js
// models/index.js
import Todo from './todo.js';

export const models = {
  todo: Todo
};

export default models;
```

```js
// app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,   // ← registry: { todo: Todo }
});

app.mount();
```

Now `'todo'` is a known type everywhere:

```js
this.ctx.store.createRecord('todo', { text: 'Ship v1' }); // → Todo instance
this.ctx.store.findMany('todo');
this.ctx.store.findOne('todo', id);
```

Convention: registry keys are lowercase singular (`todo`, `user`, `post`).

---

## Record Lifecycle

A record moves through four stages, all driven by the store:

```
createRecord(type, data)
      ↓  schema defaults applied to absent fields
Record instance (an instance of YOUR model class)
      ↓  getters + methods available; queries in data() auto-subscribe components
record.update(fields)
      ↓  fields merged, subscribers notified, subscribed data() re-runs
record.destroy()
      ↓  record removed from the store, subscribers notified
```

1. **`store.createRecord(type, data)`** — creates the record and applies every `.default()` in the schema to fields you didn't supply. With the todo schema above, `store.createRecord('todo', { text: 'Ship v1' })` produces a record with `completed: false` and fresh `createdAt`/`updatedAt` dates.
2. **The record is an instance of your class** — `record instanceof Todo` is true. Computed getters and instance methods are live from the moment it's created.
3. **`record.update(fields)`** — merges the fields, marks the record dirty, and notifies subscribers; components that queried this record in `data()` re-run and re-render. Returns the record.
4. **`record.destroy()`** — removes the record from the store and notifies subscribers so lists drop it on the next render.

Removal is terminal for that record instance. Both local `destroy()` and a
confirmed adapter `delete()` mark it deleted: a later `record.delete()` resolves
with the same record without another request, while `record.save()` rejects with
`cannot save a deleted record`. A model instance constructed directly with `new`
was never added to a store, so its first `delete()` still rejects.

See [[DOC-DATASTORE]] for the full store query surface and the reactive rendering flow.

---

## v1 Enforcement Semantics

Per [[DOC-SPEC]] §7 and §20, v1 draws a precise line between what the store *acts on* and what it merely *stores*:

- **`.default()` and `.primary()` are honored by the store.** Defaults are applied on `createRecord`; the primary key identifies records for `findOne` and updates.
- **Validation rules are enforced at the local write boundary (v1.16, D48).** `.required()`, `.min()`, `.max()`, `.oneOf()`, and `.validate()` now reject invalid data:
  - **`store.createRecord(type, data)`** validates after defaults + primary-key generation. On failure it throws **`PuzzleValidationError`** (exported from the package root) and inserts, notifies, and persists nothing.
  - **`record.update(patch)`** validates **only the fields present in the patch** (rules are per-field, so this is exact — a record created under laxer rules cannot be bricked by an unrelated update). On failure it throws and leaves the record untouched. The primary-key immutability check still runs first. Applies to store-attached and store-less records alike — the rules live on the class.
  - `err.errors` is `[{ field, rule, message }]` in schema-declaration order (rules within a field in declared order); `err.message` is the first error's message. Both methods keep their return-the-record contract on success.
  - **Non-throwing surface for form UX:** static **`Model.validate(data, { fields }?)`** (pre-create check) and instance **`record.validate()`** (current field values) return `{ valid, errors }` with the same errors shape — validate first, then write. Static validation mirrors `createRecord` acceptance: an omitted/null primary field produces no `required` error because the store will generate it; an empty-string primary key remains invalid because the store does not generate for `''`. Pass `{ fields: ['name', 'email'] }` to validate only an edited subset. There is no persistent `record.errors` state.
  - **Rule semantics** (no type coercion — rules compare what they are given): outside the static primary-key exception above, `required` fails on `undefined`/`null`/`''` and short-circuits that field's remaining rules; a non-required field that is `undefined`/`null` skips its remaining rules; `min`/`max` compare `.length` for strings/arrays and value for numbers/dates (an incomparable/NaN-ish comparison passes, never throws); `oneOf` is strict `===` membership; a custom `validate(fn)` treats a falsy return as invalid but lets a *thrown* exception propagate. **Type-aware bounds (SPEC §35):** on a field *declared* `number()`/`date()`, a wrong-runtime-type value fails `min`/`max` with a type-mismatch message (`"age" must be a number`) instead of silently measuring `.length` — form inputs hand you strings, so convert (`Number(input.value)`) before writing. Type mismatches on `string()`/`array()` fields are still not validated.
  - **Exempt by design:** `store.loadAll`/`loadOne` and public `store.upsert` (server data is authoritative — backend drift must not crash the read path) plus storage hydration (fail-soft startup). See [[DOC-SPEC]] §20.

  A worked form flow — validate first, then write:

  ```js
  events = {
    submit: (event) => {
      const patch = { name: this.getData().name, email: this.getData().email };
      const { valid, errors } = User.validate(patch);
      if (!valid) {
        this.setData('errors', errors); // render them in the template
        return;
      }
      this.ctx.store.createRecord('user', patch);
    }
  };
  ```

  Or catch the throw directly for a fail-fast path:

  ```js
  try {
    const user = this.ctx.store.createRecord('user', patch);
  } catch (err) {
    if (err instanceof PuzzleValidationError) {
      this.setData('errors', err.errors); // [{ field, rule, message }]
    } else {
      throw err;
    }
  }
  ```
- **Relationships (v1.17, D49)** — `Puzzle.belongsTo(type)` / `Puzzle.hasMany(type)` declared as schema entries resolve as **lazy store-backed getters** (see [[DOC-SPEC]] §21). They replace the old `static relationships` block from earlier drafts — do not write one; it is not part of the contract.

  ```js
  static schema = {
    id:       Puzzle.string().primary(),
    authorId: Puzzle.string(),
    author:   Puzzle.belongsTo('user'),   // → findOne('user', this.authorId)
    comments: Puzzle.hasMany('comment')   // → findMany('comment', c => c.postId === this.id)
  };
  ```

  - **Resolution is a live store query.** `post.author` ⇒ `findOne('user', post.authorId)` (`null` on a miss, a null/undefined FK, or a store-less record); `post.comments` ⇒ `findMany('comment', { filter: c => c.postId === post.id })` (`[]` when store-less; store insertion order — sort in `data()`). No materialization or caching. Cycles (`post.author.posts`) are safe because resolution is lazy.
  - **FK by convention, overridable.** `belongsTo` infers `<relationshipName>Id` (`author:` → `authorId`); `hasMany` infers `<ownerType>Id` (a `comments:` on the `post` model → `postId`). Override either with `Puzzle.belongsTo('user', { key: 'writtenBy' })`. The FK is resolved from the model-registry key when the Store installs the getters at construction.
  - **Not fields.** A relationship builder is a distinct kind (no `.required()`/`.default()` etc.): excluded from `normalizedSchema()`, so defaults, primary-key lookup, and §20 validation never see it. `toJSON()` serializes the FK, never the resolved object graph (the getters are non-enumerable).
  - **Traverse in `data()` to subscribe.** Because a getter calls the ordinary query methods, a traversal inside a tracked `data()` auto-subscribes exactly like the manual join it replaces — return traversals from `data()`:

    ```js
    data(params) {
      const post = this.ctx.store.findOne('post', params.id);
      return {
        post,
        author: post ? post.author : null,                          // subscribes 'user <authorId>'
        comments: post ? [...post.comments].sort(byDate) : []        // subscribes the 'comment' collection
      };
    }
    ```

    **Template-access caveat:** reading a relationship in the template renders current state but subscribes nothing (render runs outside the tracked eval) — always seed the traversal from `data()`.
  - **The property name is reserved.** Assigning to it (e.g. an embedded `{ author: {...} }` server payload) warns once and is ignored — set the FK field instead. This keeps `Object.assign(record, payload)` safe on the server read path.

- **Server access (D21 read + D50 write):** the model declares its server location — `static adapter = { endpoint: '/api/todos' }` — and both halves of the adapter consume it. **Read path (D21):** `await store.loadAll('todo')` / `await store.loadOne('todo', id)` fetch from `apiURL + endpoint` and upsert records (subscribed views re-render when data arrives). **Write path (D50):** `record.save()` (POST first, PUT once synced), idempotent `record.delete()` (confirmed DELETE), and `store.request(type, path, opts)` (custom endpoints) — all local-first with the same `endpoint`. `save()` **validates the full record first (§20): invalid rejects with `PuzzleValidationError` and makes no request.** Write verbs reject with `PuzzleAdapterError`; the read path keeps its plain-`Error` messages. `store.upsert(type, objectOrArray)` applies server-authoritative custom-action data without another GET, preserving existing record identity and marking records synced.

  The custom-endpoint idiom wraps `request()` in a model method, then explicitly
  upserts each record in the raw response. Envelope responses are not merged
  automatically:

  ```js
  async checkIn() {
    const payload = await this._store.request('habit', `/${this.id}/check-ins`, {
      method: 'POST'
    });
    return {
      habit: this._store.upsert('habit', payload.habit),
      checkin: this._store.upsert('checkin', payload.checkin)
    };
  }
  ```

  Each upserted object must carry its model's primary key. **Query fault-in and automatic write-through — Status: Planned — not in v1.** See [[DOC-SPEC]] §22. Local persistence is in-memory with optional localStorage.

---

## Related Documentation

- **[[DOC-SPEC]]** — the frozen v1 contract (§7 covers models)
- **[[DOC-DATASTORE]]** — store queries, records, and reactivity
- **[[DOC-ROUTER]]** — routing and navigation
- **[examples/todos/app/models/](../examples/todos/app/models/)** — the canonical model + registry
