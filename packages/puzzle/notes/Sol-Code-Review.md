# Sol Code Review: JavaScript Client Runtime

Reviewed: 2026-08-24  
Scope: `client-runtime/**/*.js`  
Mode: read-only review; no runtime source files were changed

## Review framing

This was performed with a full code-review process, but the requested goal was runtime simplification and size reduction. By useful findings, the result is roughly:

- **70% code optimization:** production bloat, redundant work, repeated control flow, and unnecessary hot-path passes.
- **30% conventional review:** correctness and containment edge cases discovered while tracing those paths.

The optimization-focused findings are 1–4 below. Findings 5–7 are incidental quality issues. None of the correctness findings indicate that the runtime is broadly unsafe to ship.

## Scope and architecture

The review covered all 43 JavaScript runtime files, prioritizing the browser-shipped graph. A controlled minimal production bundle measured **66,232 bytes minified / 21,446 bytes gzip**. Router, PuzzleView, ViewManager, Store, and Model account for roughly 86% of it.

The existing boundaries are generally sound. Adapter, morph, alternate router modes, SSG, fixtures, DevTools, Portal, and FLIP are already excluded where appropriate. Moving more features behind optional imports was deliberately not treated as an optimization opportunity.

## Optimization findings

### 1. Development diagnostics still consume production bytes and runtime work

Severity: **Important**  
Fix effort: **Refactor**  
Verification confidence: **96/100**

Locations:

- `client-runtime/datastore/store.js:95-148`
- `client-runtime/model.js:537-590`
- `client-runtime/views/animate.js:27-35,187-224`
- `client-runtime/views/viewManager.js:1100-1113,1169,1193-1197`
- `client-runtime/views/ViewNode.js:60-73,127-133`
- `client-runtime/views/PuzzleView.js:98-115`
- `client-runtime/formatters.js:64-103`

Several diagnostics are intended to be development-only but are structured in ways esbuild cannot eliminate:

```js
this._assertNoReservedFields(); // the guarded call disappears; the class method does not
const seenNewKeys = new Map();  // allocated on every keyed patch
#bindMemberLast = null;         // retained on every production view
this._warnedMissing = new Set();// allocated but never read in production
```

Retained production work includes:

- Store's two development-only class methods, `assertSchemaNames`, prototype walks, and long error strings.
- Animation warning WeakMaps/Sets, message construction, and JSON serialization.
- A `Map` per keyed reconciliation and a `Set` per keyed tag, used only for duplicate-key warnings.
- Five unused private slots on every production `PuzzleView`.
- An unread formatter-warning `Set` per app.
- Null-key warning bookkeeping.

A controlled production-only prototype that moved or gated these diagnostics reduced the bundle from **66,232 / 21,446 gzip** to **63,778 / 20,709 gzip**: a reduction of **2,454 minified bytes / 737 gzip**, about 3.4% of the measured core. It also removed the keyed-patch diagnostic allocations.

Suggested approach:

- Move Store's development checks to module-level helpers referenced only inside the inline `__PUZZLE_DEV__` gate.
- Gate animation and key-warning computation at call sites, not only the final `console` expression.
- Move binding diagnostics to development-only weak state instead of native private fields.
- Initialize formatter warning state only in development.
- Add production bundle assertions for diagnostic strings and bookkeeping sentinels.

This is an internal production cleanup, not another user-facing import boundary.

### 2. `PuzzleView.#recompose()` preserves an identity that cannot escape

Severity: **Minor**  
Fix effort: **Contained**

Location: `client-runtime/views/PuzzleView.js:2143-2175`

Current shape:

```js
const composed = { ...this.#local, ...this.#model };
for (const key of Object.keys(this.#data)) {
	if (!(key in composed)) delete this.#data[key];
}
Object.assign(this.#data, composed);
```

`#data` is private, and `getData()` always returns a fresh copy. Direct assignment removes a key-array allocation, deletion scan, and second copy from every object-valued data commit:

```js
this.#data = { ...this.#local, ...this.#model };
```

The production probe became **83 raw / 21 gzip bytes smaller**. This also fixes a reproducible edge case where an enumerable Symbol key omitted by the next model remains stale because `Object.keys()` never sees it.

The development binding diagnostic should remain immediately after the assignment. Existing two-layer state, binding, HMR, and DevTools tests cover the important surrounding behavior.

### 3. Fire-and-forget refresh containment is copied six times

Severity: **Minor**  
Fix effort: **Contained**

Locations:

- `client-runtime/views/PuzzleView.js:490-504`
- `client-runtime/views/PuzzleView.js:557-571`
- `client-runtime/views/PuzzleView.js:980-992`
- `client-runtime/views/PuzzleView.js:1287-1299`
- `client-runtime/views/PuzzleView.js:1360-1375`
- `client-runtime/views/PuzzleView.js:1980-1992`

All six paths repeat the same required containment:

```js
try {
	this.refresh(options)?.catch(handle);
} catch (err) {
	handle(err);
}
```

One private `#refreshInBackground(message, options, phase)` helper would remove six shipped copies while retaining the distinction between synchronous throws and asynchronous rejections.

The helper must preserve:

- `bind` versus `refresh` error phases;
- `{ props }` on parent updates;
- prepared-navigation token ordering;
- the store performance marker;
- restore-hook ordering.

It should not make synchronous refreshes unconditionally Promise-shaped.

### 4. Keyed reconciliation partitions old children in two passes

Severity: **Nit**  
Fix effort: **Trivial**

Location: `client-runtime/views/viewManager.js:1157-1167`

The keyed patcher first loops over `oldChildren` to build `oldKeyed`, then scans them again with `filter()` to collect `oldUnkeyed`. Push null-key children into `oldUnkeyed` during the first loop instead.

The bundle saving is negligible—**7 raw / 3 gzip bytes**—but it removes one full traversal and its callback from a hot reconciliation path while preserving source order.

## Incidental correctness findings

### 5. Prototype-named attributes and refs use unsafe ordinary-object semantics

Severity: **Minor**  
Fix effort: **Refactor**

Locations:

- `client-runtime/views/viewManager.js:1039-1048`
- `client-runtime/views/PuzzleView.js:202-211,345-359`
- `compiler/internal/parser/refs.go:119-137`

Two compiler-reachable failures were reproduced:

- Patching `{ toString: 'present' }` to `{}` leaves the DOM attribute mounted because `name in newAttrs` sees `Object.prototype.toString`.
- `<div ref="__proto__">` mutates `view.refs`' prototype instead of creating an own property; removal yields `undefined`, not the contractual `null`.

Use `Object.hasOwn(newAttrs, name)` for attribute membership and initialize `refs` with `Object.create(null)`. No compiler restriction is needed.

### 6. Duplicate BigInt keys make the warning abort rendering

Severity: **Minor**  
Fix effort: **Trivial**

Location: `client-runtime/views/viewManager.js:1105-1113`

Explicit key expressions preserve their raw type, but the duplicate-key warning uses `JSON.stringify(key)`. Two `1n` keys therefore throw:

```text
TypeError: Do not know how to serialize a BigInt
```

That turns a warn-and-continue diagnostic into a failed render. Cyclic object keys have the same problem.

The safest and smallest fix is to omit the key value from the fixed warning text. `String(key)` is not completely safe because object conversion can invoke author code.

### 7. Partial WAAPI implementations escape the animation failure boundary

Severity: **Minor**  
Fix effort: **Contained**

Location: `client-runtime/views/animate.js:74-101`

`el.animate()` is guarded, but `animation.finished.then(...)` is outside the guard. If a mock or partial polyfill returns an animation without a usable `finished` thenable, `playAnimation()` throws despite its explicit never-throw contract.

Supported modern browsers provide `finished`, so this is an uncommon compatibility edge. Still, `flip.js` already guards the same partial-implementation case.

Validate the thenable before pausing, best-effort cancel an unusable animation, and return `instantFinish()` so a partially created `fill: 'both'` effect cannot strand the element.

## Complexity that should remain

The largest-looking sections are mostly paid-for correctness rather than accidental bloat:

- Router navigation transactions and prepared-handle cleanup protect atomic commits, supersession, morph ownership, and failure recovery.
- PuzzleView's overlapping evaluation scopes and Store tracking/settle logic protect concurrent async data and subscription ownership.
- ViewManager's mount, teardown, and aborted-render walks release nested components, refs, outside listeners, portals, and partially mounted trees.
- PuzzleApp's mount epoch prevents stale awaited continuations from restarting or tearing down a newer mount cycle.
- Controlled form-property handling, slot forwarding, date revival, and model collision checks all correspond to concrete regression cases.

These areas can be reorganized only with care; flattening their branches would likely reintroduce already-fixed failures.

## Strengths

- Optional runtime capabilities are already separated and tree-shaken effectively.
- The default client graph does not accidentally include adapter, SSG, router-mode, Portal, FLIP, DevTools, or morph implementations.
- Error handling and lifecycle ownership are unusually well documented and tested.
- Recent history already contains several successful, measured simplification passes rather than unchecked feature accumulation.

## Verification

- `npx vitest run`: **102 test files, 1,871 tests passed**.
- `go test ./...`: most packages passed, but the sandbox forbade local listener creation. `internal/dev`, `internal/pieces`, `internal/serve`, and `internal/update` failed with `bind: operation not permitted`.
- The worktree was clean after the review.

## Recommendation

The runtime is structurally solid. The first finding is the meaningful optimization target: it offers a measurable bundle reduction and removes real hot-path allocation without changing supported application behavior. After that, the `#recompose()` and background-refresh cleanups are the best contained simplifications. The remaining findings are small quality fixes rather than evidence that the runtime is unsafe to ship.
