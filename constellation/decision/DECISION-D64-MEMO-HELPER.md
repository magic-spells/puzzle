---
name: D64 — this.memo(key, deps, factory) for reference-stable derived values
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-USER-GUIDE
  - FEATURE-V1-29-COMPOSITION-FIXES
---

# D64 — `this.memo(key, deps, factory)` for reference-stable derived values

## Context

Object-valued props must be built in `data()` (inline object literals are a
positioned compile error — the expression resolver would mangle their keys),
but props are compared with `shallowEqual`, so an object prop compares **by
reference**. That leaves authors a trap with no blessed exit:

- return a **fresh** object every `data()` run → the child sees a changed prop
  on every unrelated store change and re-runs its `data()` (for the
  tarot-puzzle wrapper: spurious `updateOptions()` on every card tap);
- **cache** the object → you must hand-roll invalidation with private instance
  fields (the demo's `#optsCache`/`#optsCacheEffect` pattern), which requires
  knowing shallowEqual semantics, `data()` re-run timing, and the
  instance-field escape hatch all at once.

D62 fixes handler identity at the compiler; this fixes *data* identity at the
authoring layer.

## Decision

Add one method to `PuzzleView`:

```js
memo(key, deps, factory)
```

Per-instance `Map` keyed by `key` (string). Returns the cached value while
`deps` (an array) matches the previous call positionally by `Object.is` (length
change = miss); otherwise calls `factory()`, stores `{ deps, value }`, returns
the fresh value. Synchronous, no reactivity semantics of its own — purely
reference stability for values returned from `data()`:

```js
data(params, props) {
  const { effect = 'carousel' } = this.getData();
  return {
    carouselOptions: this.memo('opts', [effect], () => ({
      effect, loop: true, slidesPerView: 2,
    })),
  };
}
```

Declared in `types/index.d.ts` as
`memo<T>(key: string, deps: unknown[], factory: () => T): T`.

## Alternatives

- **Compiler-cached inline object literals** (lift the template ban and emit
  D62-style per-site caches keyed by ingredient values) — deferred, not
  rejected: it means the Go compiler parsing object-literal structure, and the
  memo helper covers the need at zero grammar cost. Revisit if demand appears.
- **Deep-compare auto-memo inside shallowEqual** — rejected: hidden per-patch
  cost and surprising identity semantics; `===` on props is a load-bearing
  simplicity.
- **Documentation-only (bless the instance-field idiom)** — rejected as
  insufficient: the idiom takes four pieces of framework internals to derive;
  a 15-line helper removes the whole derivation.

## Consequences

- The blessed pattern for object/array props: build in `data()`, wrap in
  `this.memo(...)` keyed by the ingredients. Combined with D62, a child whose
  props are all static/cached/memoized re-runs `data()` only on real changes.
- `memo` becomes a reserved method name on `PuzzleView` (documented; user
  subclasses overriding it break themselves, same class as `refresh`).
- Cache lives for the instance lifetime; entries are small ({deps, value})
  and bounded by distinct keys the author writes.
