---
name: D184 — store.observe
status: built
connections:
  - FEATURE-STORE-OBSERVE
  - COMPONENT-STORE
  - FILE-STORE
  - DOC-DATASTORE
  - DOC-SPEC-DATA
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
---

## Context

Code outside a view (an agent bridge, an app service, a test) needs to know when records change. The only entry into the subscription graph is `withTracking`, which resets a subscriber's keys transactionally on every run and, on an adapter app, makes a tracked miss fetch. Callers outside a view had to fake a tracked evaluation to get a callback, and inherited both behaviours they did not want.

## Decision

`store.observe(type, fn)` observes the collection key; `store.observe(type, id, fn)` observes one record key. Both return `stop()`.

- The callback is linked straight into `subscribersByKey`/`keysBySubscriber` as a function subscriber. There is no `withTracking`, so no transactional reset, no request map and no fetch, on adapter apps too. It is reached unchanged through a view's per-view store handle, which binds non-find methods to the raw store.
- Delivery is the existing batched flush (D63): `fn()` runs with no arguments, at most once per flush, errors and rejected thenables logged and isolated like any subscriber.
- Each call wraps `fn` in its own closure, so observing the same function twice yields two independent observations. `stop()` drops exactly that (key, wrapper) link through `_dropSubscription`, is idempotent, and takes effect inside the current flush: delivery re-checks key membership at call time.
- The record key is spelled `type + ' ' + id`, exactly as `_findOneLocal` subscribes and `_notify` emits it. String concatenation prints `7` and `'7'` the same, so the D112 number/string-insensitivity holds; an observed record that does not exist yet fires when it is created.
- `_notify(type, id)` stamps BOTH the collection key and the record key on every path (create, `update()` via `recordChanged`, upsert, save reconciliation, `removeRecord`), so a type observation fires on create, update and remove, and a record observation on its own create, update and remove. No new notification path was needed.
- A non-string type, a non-function callback, or a null/undefined id in the three-argument form throws a plain Error in development (`__PUZZLE_DEV__`), costing no production bytes.
- DevTools `snapshot:subscriptions` reports an observer as the literal `'fn'`, the existing wire id for function subscribers.

`flush()` is declared on the public `Store` type beside `observe`; it was already documented as core public.

## Alternatives rejected

- **`store.subscribe(fn)` firing on every change** — callers would re-scan the store on every unrelated mutation; keys are the store's granularity already.
- **Observe through a synthetic `withTracking` subscriber** — inherits the transactional reset and, on adapter apps, the fault path; a view's handle would fetch.
- **Pass the changed keys or records to `fn`** — the flush gathers per subscriber, not per change; passing data would need new bookkeeping on every notify. The callback re-reads what it needs.
- **Normalize the id through `recordKey` on the key** — the key side already agrees with findOne by string concatenation; a different spelling here would split the two.
- **Dedupe by function identity** — two observe calls with the same function would share one `stop()`, so stopping one would silently stop the other.

## Consequences

One class method, about 64 bytes gzip in a production app. Observers live until stopped; nothing unsubscribes them on view teardown, so a view that observes owns calling `stop()` in its teardown. A type observation fires for every record of the type, including records only upserted by the adapter.
