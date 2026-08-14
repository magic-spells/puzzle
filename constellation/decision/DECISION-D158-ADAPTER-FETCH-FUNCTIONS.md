---
name: D158 — Adapters are per-model fetch functions; REST conventions are the shorthand (v1.73)
status: built
connections:
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
---

A model's `static adapter` object is a set of **fetch functions** the store
calls for server work. `endpoint` is shorthand that generates the standard
REST five; any function the author writes wins over its generated default, and
an adapter made *only* of author functions is fully legal — no `endpoint`, no
assumed dialect:

```js
// standard REST — the shorthand generates all five verbs
static adapter = { endpoint: '/api/posts' };

// nonstandard URL, standard JSON — return the Response, Puzzle reads it
static adapter = {
  loadAll: (fetch) => fetch('/v2/posts?include=all'),
};

// envelope API — you unwrap, because you know the shape
static adapter = {
  endpoint: '/api/posts',
  async loadAll(fetch) {
    const res = await fetch('/api/posts');
    return (await res.json()).data;
  },
  publish: (fetch, id) => fetch(`/api/posts/${id}/publish`, { method: 'PATCH' }),
};
```

Author functions receive **`fetch`** — same signature and `Response` return as
`window.fetch`, with two additions baked in: the app's D91 `beforeRequest`
hook runs first (auth applies to custom transports automatically), and the
call routes through the `_network` seam (the `/fixtures` mock intercepts it).
This is SvelteKit's `load({ fetch })` move: the argument IS the platform
primitive, arriving pre-wired. Any fetch snippet from anywhere drops in
unchanged and gains auth + mocking. A function that declares no parameter and
uses global `fetch` gets exactly what it wrote — documented plainly: the
global bypasses the auth hook and the mocks, and the parameter list is where
a reviewer can see which is in play.

The design deliberately triangulates two ecosystem lessons. EmberData assumed
a strict dialect (JSON:API) and made deviation a subclassing ceremony —
since most real servers deviate, "write a custom adapter" became the
community's chronic pain. TanStack Query won React by inverting it: *define
your fetch function*, the library owns caching and state. Puzzle takes
TanStack's contract for transport — the adapter is your fetch functions,
written in the model, no standards assumed — while keeping what a query cache
does not give: a normalized identity-keyed store, validation, reactivity, and
the D50 write-safety machinery, all applied to whatever those functions
return.

## The contract

**Five verbs the store calls.** Signature `(fetch, ...args)`; each has a
generated REST default only when `endpoint` is present:

| verb | called by | default (with `endpoint`) | must return |
|---|---|---|---|
| `loadAll(fetch, options?)` | `store.loadAll(type, options?)` | `GET endpoint`, options serialized as the query string, naked array | records array — or a `Response` |
| `loadOne(fetch, id)` | `store.loadOne(type, id)` | `GET endpoint/id`, naked object | one record object — or a `Response` |
| `create(fetch, record)` | `record.save()` (never synced) | `POST endpoint`, record JSON | the server's record (pk required — server-assigned ids arrive here), nullish for "no echo" — or a `Response` |
| `update(fetch, record)` | `record.save()` (synced) | `PUT endpoint/pk`, record JSON | same as create |
| `delete(fetch, record)` | `record.delete()` | `DELETE endpoint/pk`; 404 = already gone | nothing — or a `Response` (status checked) |

**The `Response` convenience:** an author function may return the `Response`
from its fetch instead of parsed data — Puzzle then does the ok-check
(non-OK → `PuzzleAdapterError` with status and body) and JSON-parses the body
before applying the normal shape guards. That makes the
"nonstandard URL, standard payload" case a one-liner
(`loadAll: (fetch) => fetch('/v2/posts')`) with no helper API — the
convenience is carried by the platform type, not a new vocabulary.

**Returns feed the framework-owned pipeline, which no adapter reimplements:**
upsert by primary key, D125 revision guards protecting in-flight edits, the
`_synced` provenance flip, atomic pk adoption/re-keying, the per-record write
chain, persistence, and subscriber notification. An adapter function owns the
HTTP conversation only; after the return, the store's semantics are identical
for generated and author verbs. Throwing (or returning a non-OK `Response`)
marks the operation failed; local state stays consistent and the error
rethrows to the caller.

**Custom methods.** Any other function key (`publish`, `findBySlug`,
`search`) is outside the store's contract — never called by the framework.
`store.adapter(type)` returns the model's adapter with the enhanced `fetch`
bound as the first argument (generated defaults included), so
`store.adapter('post').publish(7)` works and custom reads compose with
`store.upsert` for merging.

**`endpoint` is required only by what needs it.** A verb the app invokes with
neither an author function nor an `endpoint` to generate a default from is
the existing "no adapter declared" error, now phrased per-verb. Config
validation stays dev-loud: non-function, non-`endpoint` keys warn once.

D157 is unchanged: the capability passed to `PuzzleApp` is still what ships
and installs the module; models with no `adapter` object remain purely local;
dispatch and the enhanced-fetch builder cost a few hundred raw bytes inside
the adapter module only.

## Alternatives rejected

- **A fixed dialect with bypass-only escape (the pre-D158 state)** — an
  envelope response or a POST-for-update API forfeited all five conventions
  and rewrote the transport on `request()`/`upsert()`. EmberData's lesson is
  that "most servers deviate" is the norm, so partial override is the primary
  path, not an edge case.
- **Class-based adapters (`RESTAdapter.extend`)** — the Ember ceremony this
  design exists to avoid; a plain object of functions in the model file is
  the whole surface.
- **Serializer/normalizer hooks (`normalizeResponse`) instead of verb
  functions** — solves envelopes but not verbs, URLs, methods, or batch
  shapes; fetch functions subsume it (unwrapping is one line inside the
  function).
- **An app-level adapter registry (`adapters: { post: {...} }`)** — moves the
  fetch logic away from the model it serves; the model file is where schema,
  relationships, and server shape belong together.
- **Query-owns-fetch (`findMany` fetching lazily, full TanStack)** —
  re-rejected as in D50: `data()` is synchronous and pure; reads are always
  local, fetching is always explicit. TanStack's contract is adopted for the
  transport layer only.
- **A `request` helper object (`request.get/post/patch` returning parsed
  bodies, axios-shaped)** — tidy one-liners for the common overrides, but a
  permanent second HTTP vocabulary to document and learn, with
  almost-familiar semantics (returns bodies, not `Response`s) and an
  abstraction ceiling — headers, status branching, `FormData`, streaming all
  force a fetch fallback, leaving two idioms in the wild. The escape path
  optimizes for the platform primitive; the `Response`-return rule recovers
  the one-liner without any new API. (Also collides with the name of the D50
  `store.request()` escape hatch.)
- **Calling the argument `ctx`** — collides with the view-side `this.ctx`
  (store/router context): one small framework must not carry two unrelated
  objects under one name.
