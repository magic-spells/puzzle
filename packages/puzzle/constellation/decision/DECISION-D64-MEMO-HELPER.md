---
name: D64 — this.memo(key, deps, factory) for reference-stable derived values
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-USER-GUIDE
code_refs:
  - client-runtime/views/PuzzleView.js
---

# D64 — `this.memo(key, deps, factory)` for reference-stable derived values

## Context

Props compare shallowly (`!==` per key), so an object or array prop compares by
reference. A template expression can't *start* with an object literal
(`:opts={ { a: 1 } }` is a positioned compile error, SPEC §6), so object props
are built in `data()` — and a fresh object every `data()` run makes the child
see a changed prop on every unrelated store change.

## Decision

`PuzzleView.memo(key, deps, factory)`: a per-instance `Map` keyed by `key`.
Returns the cached value while `deps` matches the previous call positionally by
`Object.is` (a length change is a miss); otherwise runs `factory()`, stores
`{ deps, value }` and returns it. Synchronous, no reactivity of its own — only
reference stability.

```js
data() {
  const { effect = 'carousel' } = this.getData();
  return { carouselOptions: this.memo('opts', [effect], () => ({ effect, loop: true })) };
}
```

Typed in `types/index.d.ts`. The two-way-binding warning for a bound path whose
parent object is rebuilt every `data()` run points authors here too.

## Alternatives

- **Compiler-cached inline object literals** (D62-style per-site caches) —
  deferred, not rejected; revisit on demand.
- **Deep-compare props** — rejected: hidden per-patch cost; `!==` on props is
  load-bearing simplicity (D62's bailout test pins it).
- **Document a private-field cache idiom** — rejected: it needs four pieces of
  framework internals to derive.

## Consequences

- The blessed pattern for object/array props: build in `data()`, wrap in
  `this.memo(...)` keyed by the ingredients. With D62, a child whose props are
  all static, cached or memoized re-runs `data()` only on real changes.
- `memo` is a reserved `PuzzleView` method name. The cache lives for the
  instance and is bounded by the keys the author writes.
