---
name: D64 — this.memo(key, deps, factory) for reference-stable derived values
status: verified
verified_at: '2026-11-01T19:23:12.785Z'
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-USER-GUIDE
code_refs:
  - client-runtime/views/PuzzleView.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D64 — `this.memo(key, deps, factory)` for reference-stable derived values

Props compare shallowly (`!==` per key), so an object or array prop compares by reference. A template expression can't *start* with an object literal (`opts={ { a: 1 } }` is a compile error, D173), so object props are built in `data()` — and a fresh object every `data()` run makes the child see a changed prop on every unrelated store change. `memo` gives those values a stable identity.

## Decision

- `PuzzleView.memo(key, deps, factory)`: a per-instance `Map` keyed by `key`. Returns the cached value while `deps` matches the previous call positionally by `Object.is` (a length change is a miss); otherwise runs `factory()`, stores `{ deps, value }` and returns it.
- Synchronous, no reactivity of its own — only reference stability. Typed in `types/index.d.ts`.

```js
data() {
  const { effect = 'carousel' } = this.getData();
  return { carouselOptions: this.memo('opts', [effect], () => ({ effect, loop: true })) };
}
```

- The blessed pattern for object/array props: build in `data()`, wrap in `this.memo(...)` keyed by the ingredients. With D62, a child whose props are all static, cached or memoized re-runs `data()` only on real changes. The two-way-binding warning for a bound path whose parent object is rebuilt every `data()` run points here too.
- `memo` is a reserved `PuzzleView` method name. The cache lives as long as the instance and is bounded by the keys the author writes.

## Alternatives rejected

- **Deep-compare props** — hidden per-patch cost; `!==` on props is load-bearing simplicity (D62's bailout test pins it).
- **Document a private-field cache idiom** — needs too much framework internals to derive.
- **Compiler-cached inline object literals** (D62-style per-site caches) — not built; revisit only on real demand.
