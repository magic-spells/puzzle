/**
 * PuzzleView — base class for all .pzl components/views/layouts.
 *
 * A PLAIN class (constellation/doc/DOC-DECISIONS.md D15) — not a custom element, no shadow DOM.
 * The ViewManager owns all DOM; this class owns state, lifecycle, and update
 * scheduling (constellation/doc/DOC-SPEC.md §4, constellation/doc/DOC-VIEW-LIFECYCLE.md §3).
 *
 * The compiler attaches the render() method via prototype assignment after
 * the user's class definition; render() reads this.getData() and this.events
 * at render time — the base class never touches this.events (class fields
 * initialize after super() returns).
 *
 * Update triggers (constellation/doc/DOC-VIEW-LIFECYCLE.md §5):
 * - store change matching a data() query → onStoreChange → data() re-runs
 * - refresh({params|props}) from router/parent → data() re-runs
 * - a two-way bind write-back (D147) → setData + refresh, or the record's
 *   update() and the store flush behind it → data() re-runs
 * - setData() → re-render only, data() does NOT re-run
 */

import { ViewManager } from './viewManager.js';
import { playAnimation, prefersReducedMotion, isValidSpec, warnOnceForSpec } from './animate.js';
import { observeVisible } from './visibility.js';
import { registerView, unregisterView } from '../devstate.js';
import { getErrorView, reportError } from '../errors.js';
import {
	devperfCanRender,
	devperfMarkCause,
	devperfMemo,
	devperfPrepareData,
	devperfRenderCancel,
	devperfRenderEnd,
	devperfRenderPrepare,
	devperfRenderScheduled,
	devperfRenderStart,
	devperfRenderTreeBuilt,
	devperfRunData,
	devperfSlotRender,
} from '../devperf.js';

// Dev HMR guard (constellation/doc/DOC-SPEC.md §27, D57): a live-view registry feeds the
// state snapshot/restore. Gated on the __PUZZLE_DEV__ build define (production
// DCEs the register/unregister calls, so the registry import tree-shakes away).
// Both gates spell the probe INLINE — a shared `const DEV` defeats esbuild's
// per-site constant folding across method scopes (see app.js) — so production
// DCEs the calls and the registry import tree-shakes away. An undefined
// define (unbundled vitest) reads as true.

// The write-back for a bind whose resolved root is a primitive (D147; see
// __bind). One shared function for the whole module: identity-stable by
// definition, so the differ never churns the listener, and typing does nothing.
const INERT_BIND = () => {};

// D161: marks a per-view ctx and names the app ctx it derives from, so a nested
// view chains off the BASE rather than off its parent's derived ctx (one link,
// never one per level of nesting). See the constructor.
const CTX_BASE = Symbol('puzzleCtxBase');

// Dev steering for a .then-style data(), once per view CLASS (D161) — the fix is
// one edit in one file, so one warning per class is the whole message. Allocated
// lazily inside the __PUZZLE_DEV__ gate in #noteAsyncShape so production keeps
// nothing but an unused `let` for the minifier to drop.
let asyncShapeWarned = null;

export class PuzzleView {
	// Two-layer component state (Change C, SPEC §4). #local holds values written
	// via setData() (and created()-seeded state, which uses setData); #model holds
	// the latest SUCCESSFUL data() result, REPLACED wholesale on each commit (not
	// merged). #data is the composed, visible state — { ...#local, ...#model } —
	// rebuilt by #recompose() on every commit and written straight by setData().
	// Precedence: a data() commit wins over an EARLIER setData for a key (the model
	// overlays local); a LATER setData wins over the model value for that key until
	// the next commit (setData writes #data directly). getData() hands out copies of
	// #data, so its identity is internal — but it is mutated in place regardless, so
	// setData's direct writes and the recompose target stay the one object.
	#data = {};
	#local = {};
	#model = {};
	#params = {};
	#props = {};
	// Route snapshot of the navigation that delivered this view's params (v1.15,
	// D47) — set only when the router threads it through preload()/refresh(), so
	// it survives store-change refreshes and stays null off-router.
	#route = null;
	#children = [];
	// Per-instance memo cache (v1.29, D64): key → { deps, value } for
	// this.memo() reference-stable derived values. Lazily created on first use.
	#memo = null;
	// Per-instance element-ref setter cache (v1.39, D72): name → the stable setter
	// __ref(name) hands back. Lazily created on first use. The differ must see the
	// SAME attrs.ref value across renders (a fresh closure would churn every patch),
	// so the setter identity is memoised per name for this instance's lifetime.
	#refSetters = null;
	// Per-instance write-back handler caches for implicit two-way binding (D147),
	// on the same memo principle as #refSetters: the differ must see the SAME
	// '@input:bind' value across renders or patchAttrs detaches and re-attaches the
	// listener on every patch. #bindLocalMemo keys the null-target (local state)
	// handlers by "field spec"; #bindMemberMemo keys member handlers by the target
	// OBJECT first — weakly, so a discarded record's handlers go with it — then by
	// the same string. Both lazily created on first use.
	#bindLocalMemo = null;
	#bindMemberMemo = null;
	// Dev-only: the last object seen for each member "field spec" path plus a
	// write awaiting its next render. A plain-object write can otherwise disappear
	// when data() returns a fresh literal: the new object misses #bindMemberMemo and
	// its old field value replaces the edit. The pending entry records the object
	// ACTUALLY written, so a stable target, a rebuilt target that preserved the
	// value, and record replacement all stay silent. Lazily allocated behind inline
	// __PUZZLE_DEV__ gates only.
	#bindMemberLast = null;
	#bindMemberPending = null;
	#bindMemberWarned = null;
	// Dev-only: the value each local bind write last wrote, keyed by field. The
	// layer-clobber diagnostic reads it at the next recompose to notice a data()
	// commit reverting a bound key, and #bindWarned holds the keys it has already
	// reported so the warning is once per key per view rather than once per commit.
	// Neither is ever allocated in production — every touchpoint is gated INLINE on
	// __PUZZLE_DEV__.
	#bindPending = null;
	#bindWarned = null;
	#vm = null;
	#pendingFailure = null;
	#errorView = null;
	#mounted = false;
	// Anchor-race gate (Change A): set true when the non-skeleton async mount()
	// branch resumes to find its first render superseded (no commit landed) —
	// #completeMount() is then deferred to the first #commit that DOES render, so
	// mounted() never fires against the comment anchor. Cleared when it fires.
	#pendingMountHook = false;
	// ViewManager may request the one-shot enter after mount() resolves through
	// the anchor-race branch above. Keep that request pending until the landing
	// commit completes mounted() against the real root.
	#enterPending = false;
	#destroyed = false;
	#updateScheduled = false;
	#runToken = 0;
	// D161 settle loop: the run token of the refresh currently re-running data()
	// behind fetches (0 = none), and whether a store change landed during it. A
	// notification mid-settle folds into that run as one more pass rather than
	// starting a competing refresh. Underscore-public, not private: the loop that
	// reads them is installed onto this prototype by the adapter capability, so an
	// app with no adapter — where a pending set can never fill — ships none of it
	// (D157). Internal; nothing outside the framework may touch them.
	_settlingToken = 0;
	_settleDirty = false;
	// Sticky "this view's data() came back thenable at least once" (D161). The
	// `expectsAsync` hint withTracking serializes on is otherwise
	// `data.constructor.name === 'AsyncFunction'`, which a .then-style data() — a
	// plain function returning a promise — defeats: such an eval runs INLINE, is
	// found to be async, and is retried behind the in-flight chain, but the
	// abandoned first invocation's continuations still run, and the store reads
	// inside them record their faults into whichever evaluation holds `_requests`
	// when they resume — i.e. some OTHER view's settle batch. ORing this flag into
	// every expectsAsync makes every later eval of this view defer up front exactly
	// like a declared-async data(), so the window is at most this view's first-ever
	// evaluation. Underscore-public for the same reason as the two fields above:
	// the settle loop that must OR it into its own per-pass hint is installed onto
	// this prototype by the adapter capability (D157).
	_dataAsyncShape = false;

	// D146: the { params, props, route } a PREPARED (not yet committed) data() run
	// evaluates against. Non-null only while such an evaluation is in flight; the
	// params/route getters read it, and every entry point save/restores it (exact
	// stack discipline for nested synchronous evals, mirroring Store._tracking).
	#evalScope = null;
	// Every prepared evaluation of THIS view that is currently in flight, oldest
	// first. #evalScope is the last entry (or null) — see #beginEvalRun /
	// #endEvalRun for why the unwind target has to be derived from this list
	// rather than captured up front.
	#evalRuns = [];
	// Open #withCommittedScope frames. The fence suppresses #evalScope for the whole
	// dynamic extent of the OUTERMOST one, so only its exit restores the invariant.
	#fenceDepth = 0;
	// False until the FIRST data() result actually SWAPS in (v1.8, D39; v1.20
	// D52 moves the flip from data-commit to swap time). While false and a
	// renderSkeleton() is declared (compiled from <puzzle-skeleton>), renders
	// draw the skeleton; the first commit swaps in the real template. Never
	// resets — a later refresh keeps the current content until its data lands.
	#loaded = false;
	// Anti-flash hold (v1.20, D52). #skeletonShownAt is the Date.now() of the
	// FIRST skeleton render (0 = the skeleton never appeared — sync data, no
	// skeleton). #holdTimer is the pending deferred-swap timer while the loaded
	// swap is held so a briefly-shown skeleton doesn't flash away too fast.
	#skeletonShownAt = 0;
	#holdTimer = null;
	// Animation bookkeeping (constellation/doc/DOC-SPEC.md §12).
	#playedIn = false; // playIn() runs at most once per mount
	#currentAnimation = null; // live { finished, cancel, play } handle, for interruption
	// The router may need to restore a committed view after its out animation
	// finished under fill:'both'. Keep that Puzzle-owned handle past natural
	// completion so recovery can cancel only it, never app-owned root animations.
	#outHandle = null;
	// playOut is one-shot even when the router restores a stalled outgoing view:
	// #outTask keeps the spent memo for a later instant swap, while #leaving names
	// only the CURRENT inert interval and can therefore be cleared by recovery.
	#outTask = null;
	#leaving = null;
	// Scroll-triggered enter (v1.40, D73). While a `trigger: 'visible'` enter is
	// held waiting for the element to scroll into view: #disarmVisible stops the
	// shared IntersectionObserver observation and #enterResolve resolves the
	// pending playIn() promise on destroy/interrupt, so a torn-down view never
	// leaks a forever-pending promise with retained closures. Both null when no
	// visible-trigger enter is pending.
	#disarmVisible = null;
	#enterResolve = null;

	/**
	 * Live element refs (v1.39, D72): `ref="name"` in the template populates
	 * this.refs[name] with the mounted DOM element and nulls it on unmount. A
	 * PUBLIC instance field, NOT render data — never composed into #data, never
	 * returned by getData(), never snapshotted by the dev HMR path (devstate reads
	 * the local layer via _localState(), which is #local — refs stays out for
	 * free). The compiler emits `ref: this.__ref("name")` in a vnode's attrs; the
	 * ViewManager calls that setter on mount/unmount (see __ref below).
	 */
	refs = {};

	/** @param {object} ctx exactly { store, router, formatters } (SPEC §10) */
	constructor(ctx = {}) {
		// D161 tracked-read attribution. On an adapter app this view reads the store
		// through its OWN handle: only reads made through `this.ctx.store`, by this
		// view, during this view's data() evaluation may fault in what they missed.
		// A read by anyone else — the raw `app.store`, another view's handle, a
		// module capture — is a local snapshot and can neither fire a request nor
		// land a failure in a batch it does not own.
		//
		// The derived ctx is prototype-chained off the app's, so `router`,
		// `formatters` and anything else stay LIVE rather than snapshotted, and it
		// is always chained off the BASE ctx: a component built with its parent's
		// derived ctx would otherwise add a link per level of nesting.
		//
		// `_handleFor` returns null without the adapter capability (and is absent
		// entirely when the module is not in the graph), so an adapter-free app
		// keeps `this.ctx === ctx` and `ctx.store === app.store` — identity and all
		// (D157).
		const handle = ctx.store?._handleFor?.(this);
		if (handle) {
			const base = ctx[CTX_BASE] ?? ctx;
			this.ctx = Object.create(base, {
				store: { value: handle, enumerable: true },
				[CTX_BASE]: { value: base },
			});
		} else this.ctx = ctx;
	}

	// ---- state ---------------------------------------------------------------

	/** The composed component model — the local layer overlaid by data()'s result. */
	getData() {
		return { ...this.#data };
	}

	/**
	 * Write local UI state and schedule a re-render. Never re-runs data(). Accepts
	 * (key, value) or an object map. Safe before mount (e.g. in created()) — it just
	 * seeds state for the first data() run to read back.
	 *
	 * Two-layer state (Change C, SPEC §4): the write targets the LOCAL layer AND the
	 * visible #data directly, so the value shows immediately and wins over any model
	 * value for that key until the next data() commit recomposes (a later setData
	 * beats the model; a data() commit beats an earlier setData).
	 */
	setData(key, value) {
		if (this.#destroyed || this.#leaving) return;
		if (typeof key === 'object' && key !== null) {
			Object.assign(this.#local, key);
			Object.assign(this.#data, key);
		} else {
			this.#local[key] = value;
			this.#data[key] = value;
		}
		this.#scheduleRender();
	}

	/**
	 * The LOCAL layer only (setData + created()-seeded state), as a fresh shallow
	 * copy. INTERNAL — not public API: the dev HMR snapshot (constellation/doc/DOC-SPEC.md
	 * §27, D57; Change D) restores only genuinely-local state (drafts, toggles) and
	 * lets data() recompute store-derived values against the transplanted store, so
	 * it must read this layer, not the merged getData(). Underscore-prefixed by the
	 * codebase's internal convention (like _store/_type), never spelled in a template.
	 */
	_localState() {
		return { ...this.#local };
	}

	/**
	 * The MODEL layer only (the last data() commit), as a fresh shallow copy.
	 * INTERNAL — not public API: the DevTools bridge (constellation/doc/DOC-SPEC.md
	 * §27, D100) shows the two state layers SEPARATELY, so it needs this alongside
	 * _localState() rather than the merged getData(). Same underscore-prefixed
	 * internal convention, never spelled in a template.
	 */
	_modelState() {
		return { ...this.#model };
	}

	/**
	 * This instance's current vnode tree, or null before the first render.
	 * INTERNAL dev reader for devstate/devtools (D100): the DevTools bridge walks
	 * it to discover child component instances (`vnode.component`) and so builds
	 * the live component forest without reaching into Router privates.
	 */
	_vnodeTree() {
		return this.#vm?.currentTree ?? null;
	}

	/**
	 * Reference-stable derived value (v1.29, D64; constellation/doc/DOC-SPEC.md §32).
	 * Per-instance cache keyed by `key`: returns the previously cached value while
	 * `deps` (an array) matches the prior call for that key positionally by
	 * `Object.is` (so a NaN dep matches a NaN dep — a bare `===` never would, and
	 * the factory would re-run every render defeating the reference-stability
	 * contract; a length change counts as a miss); otherwise runs `factory()`, caches
	 * `{ deps, value }`, and returns the fresh value.
	 *
	 * The blessed way to return object/array props from data(): props compare with
	 * shallowEqual, so an object prop compares BY REFERENCE — a fresh literal every
	 * data() run makes the child see a changed prop on every unrelated store change.
	 * Wrap it here, keyed by the ingredients, and its identity stays stable until an
	 * ingredient actually changes. Synchronous; no reactivity semantics of its own.
	 *
	 * @param {string} key    stable cache key (author-chosen; distinct per value)
	 * @param {unknown[]} deps ingredients compared positionally by Object.is against
	 *   the previous call for this key
	 * @param {() => T} factory builds the value on a miss
	 * @returns {T} the cached value on a hit, else the freshly built one
	 * @template T
	 */
	memo(key, deps, factory) {
		const cache = (this.#memo ??= new Map());
		const hit = cache.get(key);
		if (
			hit &&
			hit.deps.length === deps.length &&
			hit.deps.every((d, i) => Object.is(d, deps[i]))
		) {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				devperfMemo(this, key, true);
			}
			return hit.value;
		}
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfMemo(this, key, false);
		}
		const value = factory();
		cache.set(key, { deps, value });
		return value;
	}

	/**
	 * Element-ref binder (v1.39, D72; SPEC §4). Returns a PER-INSTANCE CACHED setter
	 * for `name` — the SAME function identity every call, so the differ sees an
	 * unchanging attrs.ref across renders and never churns (a fresh closure would
	 * re-invoke the ref binding on every patch). The compiler emits this inline in a
	 * vnode's attrs (`ref: this.__ref("chart")`), where `this` is this view; the
	 * ViewManager invokes the returned setter on mount and unmount.
	 *
	 * The setter's contract (matches the ViewManager call sites):
	 * - `setter(el)` on mount → this.refs[name] = el.
	 * - `setter(null, oldEl)` on unmount → this.refs[name] = null ONLY IF the current
	 *   ref is still oldEl. The guard makes mount/unmount ordering during a
	 *   replacement order-independent: a fresh element's mount may set the ref BEFORE
	 *   the old element's removal fires null, and the stale null must not clobber the
	 *   newer element.
	 * - After destroy() it bails quietly (no throw, no post-mortem mutation): the
	 *   torn-down instance's refs are being discarded, and #vm.clear() fires removal
	 *   setters during teardown when #destroyed is already true.
	 *
	 * INTERNAL — underscore-prefixed like the compiler-facing surface; never spelled
	 * in a template. Not part of the public typed API.
	 */
	__ref(name) {
		const cache = (this.#refSetters ??= new Map());
		let setter = cache.get(name);
		if (!setter) {
			setter = (el, oldEl) => {
				if (this.#destroyed) return;
				if (el != null) {
					this.refs[name] = el;
				} else if (this.refs[name] === oldEl) {
					this.refs[name] = null;
				}
			};
			cache.set(name, setter);
		}
		return setter;
	}

	/**
	 * INTERNAL — the write-back handler for one implicitly-bound form control
	 * (D147, SPEC §6). The compiler emits this inline in a vnode's attrs on a
	 * qualifying `<input>`/`<textarea>`/`<select>`:
	 * `'@input:bind': this.__bind(null, 'draft', 'v')`.
	 *
	 * - `target` is null for a bare identifier bind (local component state) or the
	 *   resolved ROOT object of a one-member path (`todo.completed` → the loop
	 *   variable, `profile.hue` → the data() value). The write arm is chosen from
	 *   the target at write time, not here — a data() commit can swap a plain
	 *   object for a record between renders.
	 * - `key` is the field to write.
	 * - `spec` is the compile-time coercion: 'v' string, 'vn' numeric, 'c' boolean.
	 *
	 * Memoized on (target, key, spec) so the identity is stable across renders;
	 * see the #bindLocalMemo/#bindMemberMemo field notes. It consumes no `__h`
	 * handler-site index.
	 *
	 * INTERNAL — underscore-prefixed like the rest of the compiler-facing surface;
	 * never spelled in a template. Not part of the public typed API.
	 */
	__bind(target, key, spec) {
		// A member path whose ROOT resolves to a primitive is not a writable target
		// — `value={ title.length }` over a string `title` is the classic case. The
		// compiler cannot see runtime types, so it emits the bind for any qualifying
		// one-member path; the primitive-rooted ones degrade here to the one-way
		// display binding they always were, instead of throwing at render (a
		// primitive is not a legal WeakMap key). No memo entry: INERT_BIND is a
		// single shared function, so the identity is stable without one.
		if (target != null && typeof target !== 'object' && typeof target !== 'function') {
			return INERT_BIND;
		}
		let store;
		if (target == null) {
			store = (this.#bindLocalMemo ??= new Map());
		} else {
			const byTarget = (this.#bindMemberMemo ??= new WeakMap());
			store = byTarget.get(target);
			if (!store) byTarget.set(target, (store = new Map()));
		}
		// Neither a field name nor a spec code can contain a space, so this is an
		// unambiguous composite key.
		const memoKey = key + ' ' + spec;
		let fn = store.get(memoKey);
		if (!fn) {
			fn = (event) => {
				// IME guard: once the framework owns the listener it owns this. Writing
				// state mid-composition re-asserts the input's value and aborts the IME
				// session in Chrome/Safari. The final `input` after compositionend
				// carries isComposing:false, so the composed text still lands.
				if (event.isComposing) return;
				const el = event.target;
				let value;
				if (spec === 'c') value = !!el.checked;
				else if (spec === 'vn') {
					// Number('') is 0 — writing it would rewrite a just-cleared field to
					// "0" and jump the caret, so an emptied numeric field writes null
					// (displayValue(null) is '', so the echo compare stays equal).
					if (el.value === '') value = null;
					else {
						value = Number(el.value);
						// Number('-') is NaN, which PASSES the model's bound checks and
						// would render the literal "NaN". Skip the whole write instead.
						if (Number.isNaN(value)) return;
					}
				} else value = el.value;
				this.#bindWrite(target, key, value, spec);
			};
			store.set(memoKey, fn);
		}
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (target != null) {
				const last = (this.#bindMemberLast ??= new Map());
				const previous = last.get(memoKey);
				const pending = this.#bindMemberPending?.get(memoKey);
				if (pending) {
					if (target === pending.target) {
						// A stable target reappeared in this render. Whatever data() did to
						// its field is not the rebuilt-literal hazard this diagnostic names.
						pending.sawTarget = true;
					} else if (
						previous !== undefined &&
						previous !== target &&
						target[key] !== pending.value
					) {
						// Do not warn inline: a loop renders many member targets under the
						// same (key, spec), and the object that was written may appear later
						// in this same tree. Collect one replacement candidate and let the
						// render tail prove the old target never returned; multiple candidates
						// make the path ambiguous and deliberately suppress the diagnostic.
						if (pending.replacement == null) pending.replacement = target;
						else if (pending.replacement !== target) pending.ambiguous = true;
					}
				}
				last.set(memoKey, target);
			}
		}
		return fn;
	}

	/**
	 * Apply one bind write. Three arms, decided by the target:
	 *
	 * 1. null → local component state. refresh(), not a bare setData: a bound
	 *    filter field feeding a data()-derived list must narrow it as you type, and
	 *    setData never re-runs data(). #renderNow disarms the frame setData armed,
	 *    so this still costs exactly one render.
	 * 2. a PuzzleModel record → its validated update(). Duck-typed on `update` and
	 *    a string `_type` TOGETHER (this file must not import model.js); a plain
	 *    object that merely owns an update() method is not a record. update()
	 *    validates and throws BEFORE mutating, so a rejected write leaves the
	 *    record — and the typed text on screen — untouched.
	 * 3. anything else → direct mutation plus a repaint of the owning view.
	 */
	#bindWrite(target, key, value, spec) {
		if (target == null) {
			this.setData(key, value);
			// Arm the clobber diagnostic BEFORE the refresh: the commit this refresh
			// drives is the one that can revert the write, so it is the commit that
			// must see the pending value. A Map keyed by field keeps only the LATEST
			// write per key, which is exactly the "no later bind superseded it" rule.
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				(this.#bindPending ??= new Map()).set(key, value);
			}
			// Bind handlers are fire-and-forget DOM listeners, so both a synchronous
			// data() throw and an async rejection must enter D145 here. Leaving either
			// bare escapes the event path; the phase stays 'bind' because this refresh is
			// the second half of the write, not an ambient refresh delivery.
			try {
				this.refresh()?.catch((err) =>
					this.#handleViewFailure(
						'[puzzle] data() failed after a bound write:',
						err,
						'bind'
					)
				);
			} catch (err) {
				this.#handleViewFailure(
					'[puzzle] data() failed after a bound write:',
					err,
					'bind'
				);
			}
		} else if (typeof target.update === 'function' && typeof target._type === 'string') {
			try {
				// The store's batched flush drives the re-render and the persistence write.
				target.update({ [key]: value });
			} catch (err) {
				reportError(
					this.ctx,
					err,
					{ phase: 'bind', view: this, route: this.route },
					'[puzzle] bound write rejected:',
					err
				);
			}
		} else {
			// Contain the assignment exactly like the record arm above. The write target
			// is app-supplied and need not be writable: `route.query` is frozen (D83), so
			// `data() { return { query: this.route.query } }` with `value={ query.q }` is
			// enough — as is any getter-only property — and in strict mode (every module
			// is) the assignment THROWS. Bare, that throw escapes the DOM listener on
			// every keystroke as an uncaught window error, never reaching the D145 funnel.
			// The input keeps the typed text either way; only the write is lost.
			try {
				target[key] = value;
			} catch (err) {
				reportError(
					this.ctx,
					err,
					{ phase: 'bind', view: this, route: this.route },
					'[puzzle] bound write rejected:',
					err
				);
				// Stop here rather than falling through. Nothing was written, so the
				// clobber diagnostic below has no write to watch for and the refresh
				// would re-render byte-identical state whose only visible effect is
				// snapping the control back mid-keystroke. The input keeps the typed
				// text; the error explains why it did not stick.
				return;
			}
			// Arm only the plain-object arm: a record replacement is legitimate identity
			// churn and its validated update/store flush owns reactivity. The next render
			// consumes this entry after __bind has shown whether the exact object returned
			// or one unambiguous replacement discarded the value.
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				(this.#bindMemberPending ??= new Map()).set(key + ' ' + spec, {
					key,
					target,
					value,
					sawTarget: false,
					replacement: null,
					ambiguous: false,
				});
			}
			try {
				this.refresh()?.catch((err) =>
					this.#handleViewFailure(
						'[puzzle] data() failed after a bound write:',
						err,
						'bind'
					)
				);
			} catch (err) {
				this.#handleViewFailure(
					'[puzzle] data() failed after a bound write:',
					err,
					'bind'
				);
			}
		}
	}

	/** INTERNAL — whether this failed position is waiting for an explicit retry. */
	__hasErrorReplacement() {
		return !!this.#errorView;
	}

	/** Preserve the manager's exact position before destroying this view. */
	#plantFailurePlaceholder() {
		return this.#vm?.plantFailurePlaceholder();
	}

	/** Tear down a replacement when its parent/router removes the position. */
	#disposeFailurePosition() {
		this.#errorView?.destroy();
		this.#errorView = null;
		this.__failedPlaceholder?.remove();
		this.__failedPlaceholder = null;
	}

	/**
	 * INTERNAL — destroy the failed view and mount the app's ordinary error view at
	 * this exact position. Returns whether that error view mounted successfully.
	 */
	async __showErrorView(error, info) {
		if (!this.#vm) {
			if (!this.#destroyed) this.#pendingFailure = { error, info };
			return false;
		}
		if (this.#destroyed && !this.#errorView) return false;
		if (this.#errorView) return true;

		const placeholder = this.#plantFailurePlaceholder();
		this.ctx.router?.__failedView?.(this);
		this.destroy();
		if (placeholder) this.__failedPlaceholder = placeholder;

		const ErrorView = getErrorView(this.ctx);
		if (!ErrorView) return false;

		return this.#mountErrorView(ErrorView, error, info);
	}

	/**
	 * INTERNAL — refresh this failed position's face after a RETRY whose rebuild
	 * failed in the router's LOAD phase (D145/v1.71). A load failure obeys the
	 * D19/D61 stay-put rule — no URL, no history entry, no half-built page, the user
	 * keeps the page already on screen. Here that page IS the face the retry press
	 * held up, so staying put alone would leave it showing a stale error with a
	 * closure that can never fire again. The router calls this from that catch to
	 * swap in a face carrying the NEW error and a pressable retry.
	 *
	 * Deliberately NOT folded into __showErrorView: this instance is already
	 * destroyed, already marked chain-invalid in the router, and its placeholder
	 * still holds the slot — so that prologue (plant, mark, destroy) must not run
	 * again, and its `destroyed && !errorView` guard has to keep refusing every other
	 * caller, since a torn-down position must never resurrect itself on its own.
	 */
	__retryErrorView(error, info) {
		// Only a position that is still OURS: no #vm means this instance never
		// mounted, and an unparented placeholder means the position was released by a
		// parent patch or a later navigation.
		if (!this.#vm || !this.__failedPlaceholder?.parentNode) return false;

		const ErrorView = getErrorView(this.ctx);
		if (!ErrorView) return false;
		// Clear the link BEFORE tearing the held face down: its own __errorViewFailed
		// hook nulls #errorView when it still points at that instance, which would
		// otherwise drop the successor mounted below.
		const held = this.#errorView;
		this.#errorView = null;
		held?.destroy();
		return this.#mountErrorView(ErrorView, error, info);
	}

	/**
	 * One single-flight retry closure per MOUNTED error view, bound to the face it
	 * was handed to — so the closure a REPLACED face gave out is permanently spent
	 * while the live face's own closure keeps working.
	 *
	 * A retry HOLDS its face up for the whole rebuild. Nothing here tears it down;
	 * the position is only ever vacated by something that immediately refills it — a
	 * successful commit destroys this instance as it mounts the rebuilt chain (and
	 * destroy() disposes the face with it), and a load failure swaps the face through
	 * __retryErrorView. Every other outcome — a guard that blocks or redirects
	 * nowhere, a supersession, a superseding navigation that itself stays put — leaves
	 * the face exactly where it was, so no press can end at an empty position.
	 *
	 * The latch spans one press: it blocks a concurrent second press and RE-ARMS when
	 * the rebuild ends with this same face still mounted, which is precisely the set
	 * of outcomes that changed nothing on screen. A face that was replaced or disposed
	 * fails the identity check instead, so the latch never has to tell them apart.
	 */
	#makeRetry(face) {
		let inFlight = false;
		return async () => {
			if (inFlight || this.#errorView !== face) return;
			inFlight = true;
			const rebuilt = this.ctx.router?.__failedView?.(this, true);
			if (rebuilt) {
				await rebuilt;
				if (this.#errorView === face) inFlight = false;
				return;
			}
			// A component position rebuilds through its OWNER's patch, and the patcher
			// remounts a failed component only where it finds no face (viewManager's
			// __hasErrorReplacement check) — so this path hands the position back empty
			// and its closure stays spent. The owner's re-render refills it.
			this.#errorView = null;
			face.destroy();
			const owner = this.__retryParent;
			try {
				await owner?.refresh();
			} catch (err) {
				// The owner's own data() rejected — the ordinary outcome of retrying
				// while the server is still down. Nothing re-renders this position, so the
				// empty handoff above would strand it as a bare placeholder and break the
				// SPEC rule that a retry never blanks its position. Refill it the way a
				// routed load failure does: a face carrying the NEW error and a fresh
				// callback. refresh() contains no failure of its own — every caller owns
				// its catch — so this is the single funnel report for it, attributed to
				// the OWNER whose data() threw. The face torn down above makes
				// __retryErrorView's `held` teardown a no-op, and its guards refuse only
				// when the position is no longer ours — in which case whoever took it owns
				// what stands there.
				const info = reportError(
					this.ctx,
					err,
					{ phase: 'refresh', view: owner, route: owner?.route },
					'[puzzle] retry through the owner failed:',
					err
				);
				this.__retryErrorView(err, info);
			}
		};
	}

	async #mountErrorView(ErrorView, error, info) {
		let errorView;
		try {
			errorView = new ErrorView(this.ctx);
		} catch (err) {
			reportError(
				this.ctx,
				err,
				{ phase: 'error-view', route: info.route },
				'[puzzle] error view failed:',
				err
			);
			return false;
		}
		this.#errorView = errorView;
		errorView.__errorViewFailed = () => {
			if (this.#errorView === errorView) this.#errorView = null;
			errorView.destroy();
		};
		try {
			await errorView.mount(this.#vm.container, {
				props: { error, info, retry: this.#makeRetry(errorView) },
				ref: this.__failedPlaceholder,
			});
			if (this.#errorView !== errorView) {
				errorView.destroy();
				return false;
			}
			return !errorView.isDestroyed;
		} catch (err) {
			reportError(
				this.ctx,
				err,
				{ phase: 'error-view', view: errorView, route: info.route },
				'[puzzle] error view failed:',
				err
			);
			errorView.destroy();
			if (this.#errorView === errorView) this.#errorView = null;
			return false;
		}
	}

	/**
	 * The DOM node occupying this component's position (null before mount).
	 * While an async data() is in flight this is the anchor placeholder, so
	 * a parent's sibling insertion refs stay valid (constellation/doc/DOC-APP-ANATOMY.md §4).
	 */
	get element() {
		return (
			this.#errorView?.element ??
			(this.__failedPlaceholder?.parentNode ? this.__failedPlaceholder : null) ??
			this.#vm?.element ??
			null
		);
	}

	/**
	 * Whether the first data() result has committed (v1.8, D39). False while a
	 * skeleton (or the anchor placeholder) holds this component's position.
	 */
	get loaded() {
		return this.#loaded;
	}

	/**
	 * True once destroy() has run (constellation/doc/DOC-VIEW-LIFECYCLE.md §3).
	 * The Store probes this at its subscription choke points (_subscribe /
	 * withTracking) to skip a torn-down subscriber whose async data() is still
	 * suspended at an await: without the skip, the resumed eval's queries would
	 * re-subscribe this instance AFTER destroy()/unsubscribe() dropped its keys —
	 * a permanent-retention leak. Any custom store subscriber MAY expose an
	 * `isDestroyed` getter to opt into the same liveness skip; a plain function
	 * subscriber (no such property) is unaffected.
	 */
	get isDestroyed() {
		return this.#destroyed;
	}

	get params() {
		return this.#evalScope ? this.#evalScope.params : this.#params;
	}

	get props() {
		return this.#props;
	}

	/**
	 * The route snapshot of the navigation that delivered this view's params
	 * (v1.15, D47): { path, route, params, chain } — same shape as
	 * router.current, but it describes the navigation this data() run is
	 * GATING, so it is correct during the pre-commit D19 load phase (where
	 * router.current and location.* still hold the old route) and in every
	 * router mode. Null for components not mounted by the router. Persists
	 * across store-change refreshes; overwritten by the next navigation.
	 */
	get route() {
		// D146: inside a PREPARED data() evaluation the view must see the DESTINATION
		// snapshot (D47's invariant — data() describes the navigation it is gating)
		// while its COMMITTED #route still names the live route, so a failed navigation
		// has nothing to roll back. #evalScope is that window; #renderNow() clears it
		// for the duration of a render so a paint that lands mid-gate (a store-change
		// refresh while a prepared async data() is suspended) reads committed state.
		return this.#evalScope ? this.#evalScope.route : this.#route;
	}

	// ---- lifecycle -------------------------------------------------------------

	/**
	 * Mount into a container element. Lifecycle: created → data() (awaited)
	 * → render → mounted (constellation/doc/DOC-VIEW-LIFECYCLE.md §3).
	 *
	 * A parent's ViewManager also calls this to mount a child component
	 * (constellation/doc/DOC-APP-ANATOMY.md §4): `children` is the slot content captured at the
	 * call site (rendered at the child's `<Children/>`) and `ref` is the DOM node
	 * to insert before. The anchor placeholder reserves the position
	 * synchronously so an async data() does not strand the parent's insertion
	 * refs.
	 *
	 * If destroy() runs while an async data() is awaited (the non-preloaded
	 * branch), this returns without setting #mounted or firing mounted() — a
	 * component torn down before its data resolves must not re-subscribe, start
	 * timers, or grab focus from a mounted() hook (constellation/doc/DOC-VIEW-LIFECYCLE.md §3).
	 */
	async mount(container, { params = {}, props = {}, children = [], ref = null, preloaded = false } = {}) {
		this.#vm = new ViewManager(container, this.ctx, this);
		this.#vm.slotChildren = children;
		if (!preloaded) {
			this.#params = params;
			this.#props = props;
		}
		this.#children = children;
		this.#vm.anchorAt(ref);

		// preloaded: created() + data() already ran in preload() (constellation/doc/DOC-APP-ANATOMY.md
		// §5) — just render the resolved model into the reserved position. This keeps
		// the mount synchronous so the Router's COMMIT stays atomic (D19).
		if (preloaded) {
			// Only a prerender takeover ever stamps __takeoverTree, so a bundle built
			// without the takeover path folds this to the bare `#renderNow()` it was
			// before the feature existed — no hasOwnProperty probe and, more to the
			// point, no `delete` (which can push the instance into dictionary mode) on
			// every router-preloaded mount. Probed INLINE: hoisting the define into a
			// module const stops esbuild propagating it here (see build_test.go).
			if (typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__) {
				const takeoverTree = Object.prototype.hasOwnProperty.call(this, '__takeoverTree')
					? this.__takeoverTree
					: undefined;
				delete this.__takeoverTree;
				this.#renderNow(takeoverTree);
			} else {
				this.#renderNow();
			}
		} else {
			this.created();
			const pending = this.refresh();
			if (pending && typeof this.renderSkeleton === 'function') {
				// Skeleton + async data() (v1.8, D39): render the skeleton into the
				// reserved position NOW and resolve the mount — the real render
				// patches over it when data() commits. The mount promise no longer
				// waits on data, so a data() rejection surfaces here (logged), not to
				// the caller; the skeleton stays up.
				pending.catch((err) =>
					this.#handleViewFailure('[puzzle] data() failed behind a skeleton:', err, 'mount')
				);
				this.#renderNow();
			} else {
				await pending;
				// destroy() may have run during the await — a torn-down instance must
				// not fire mounted() (would re-subscribe / start timers / steal focus).
				if (this.#destroyed) return this;
				// mounted() anchor-race gate (Change A). A parent prop update landing
				// during the await calls refresh({props}) → bumps #runToken, so the
				// token-1 #commit skips its render as SUPERSEDED: no first render has
				// committed, #loaded is still false, and this.element is the comment
				// anchor. Firing mounted() now would hand the hook the anchor, not a
				// real element (constellation/doc/DOC-VIEW-LIFECYCLE.md §3). Defer mount
				// completion to the #commit that DOES render first (the superseding
				// one), mirroring the slot-only branch's #mounted gate. When the token-1
				// refresh committed normally, #loaded is already true → complete inline.
				if (!this.#loaded) {
					this.#pendingMountHook = true;
					this.#flushPendingFailure();
					return this;
				}
			}
		}

		this.#completeMount();
		this.#flushPendingFailure();
		return this;
	}

	/**
	 * Surface an already-reported error buffered before this instance had a
	 * ViewManager. Runs once; the error view receives the exact frozen info object
	 * the reporting funnel saw.
	 */
	#flushPendingFailure() {
		const pending = this.#pendingFailure;
		if (!pending || this.#destroyed) return;
		this.#pendingFailure = null;
		this.__showErrorView(pending.error, pending.info);
	}

	/**
	 * Finish the mount: flip #mounted, join the dev live-view registry, fire
	 * mounted(). The convergence point every mount branch reaches once its first
	 * render has committed. Normally called at the end of mount(); the anchor-race
	 * gate (Change A) defers it to the first landing #commit when a parent prop
	 * update supersedes the initial async data(). Idempotent and destroy-guarded,
	 * so mounted() fires exactly once and never on a torn-down view.
	 */
	#completeMount() {
		// D136 §3 — a LEAVING view is inert. Since 0.7.0 a plain hide hook (no
		// animations.out) also routes removal through destroyAnimated(), so ordinary
		// component removal is asynchronous and this can be reached after the owner
		// let go: an async data() resolving mid-leave would otherwise fire mounted()
		// on a view already on its way out (re-subscribing, starting timers, taking
		// focus). Same guard the setData/refresh/applyParentUpdate/onStoreChange
		// entry points carry.
		if (this.#mounted || this.#destroyed || this.#leaving) return;
		this.#mounted = true;
		// Dev HMR (constellation/doc/DOC-SPEC.md §27, D57): join the live-view registry at the
		// #mounted-true convergence point, so the snapshot can key and read this
		// instance's state. Removed in destroy().
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) registerView(this);
		// D146: user code, fenced to committed params/route (see #withCommittedScope).
		this.#withCommittedScope(() => this.mounted());
	}

	/**
	 * Run created() + data() (awaited, subscriptions tracked) WITHOUT touching the
	 * DOM — there is no ViewManager yet, so the render inside refresh() no-ops. The
	 * Router calls this to resolve a routed view's data() BEFORE it commits the
	 * navigation (constellation/doc/DOC-VIEW-LIFECYCLE.md §4): pushState and the layout render only
	 * happen once this promise settles. A later mount({ preloaded: true }) attaches
	 * the already-loaded instance without re-running created()/data().
	 */
	async preload({ params = {}, props = {}, route } = {}) {
		if (this.#destroyed) return this;
		this.#params = params;
		this.#props = props;
		if (route !== undefined) this.#route = route;
		this.created();
		await this.refresh();
		return this;
	}

	/**
	 * Parent re-render hook (constellation/doc/DOC-APP-ANATOMY.md §4). The ViewManager reuses
	 * this instance for a matching component vnode and forwards the fresh slot
	 * content plus changed props: props re-run data() (prop reactivity); a slot
	 * content swap alone re-renders without re-running data().
	 */
	applyParentUpdate({ props, children }) {
		if (this.#destroyed || this.#leaving) return;
		const hadSlots = this.#children.length > 0;
		if (children !== undefined) {
			this.#children = children;
			if (this.#vm) this.#vm.slotChildren = children;
		}
		if (props !== undefined) {
			// Fire-and-forget: a data() failure is logged rather than escaping into
			// the parent's patch path (mount's skeleton-path style). A rejecting
			// ASYNC data() comes back through refresh()'s promise (.catch); a SYNC
			// throw comes straight back OUT of refresh() — withTracking rethrows sync
			// errors so the router/mount callers still see them — so the try/catch
			// catches it here too. refresh() returns undefined on the sync path (or
			// when destroyed) — hence the optional chain.
			try {
				this.refresh({ props })?.catch((err) =>
					this.#handleBackgroundRefreshFailure(
						'[puzzle] data() failed during a parent prop update:',
						err
					)
				);
			} catch (err) {
				this.#handleBackgroundRefreshFailure(
					'[puzzle] data() failed during a parent prop update:',
					err
				);
			}
		} else if (this.#mounted && (hadSlots || this.#children.length > 0)) {
			// The #mounted gate: a slot-only re-render must NEVER run the real
			// template before this view's first data() has committed. A non-skeleton
			// async child holds only the anchor placeholder while its data() is in
			// flight (#vm already exists, but #mounted/#loaded are still false); a
			// concurrent parent re-render lands here with props shallow-equal
			// (undefined) and slot content present. Without the gate #renderNow()
			// would call this.render() against un-committed #data — a mid-patch throw
			// or a premature/blank paint — violating the anchor/skeleton contract
			// (constellation/doc/DOC-VIEW-LIFECYCLE.md §3). The fresh slotChildren are
			// already stored above, so the pending first #commit renders them in
			// anyway. A skeleton child reaches #mounted almost immediately (its mount
			// branch never awaits), so its slot-only re-renders keep flowing.
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				devperfSlotRender(this);
			}
			this.#renderNow();
		}
	}

	/**
	 * Latch `_dataAsyncShape` the first time a data() invocation comes back thenable
	 * (D161). Called from every eval wrapper, so the flag engages whichever entry
	 * point happened to run first. In dev it also steers a .then-style data() at the
	 * declaration that would have made it serialize from the start; a declared-async
	 * data() latches the flag silently, since it already defers up front.
	 */
	#noteAsyncShape() {
		if (this._dataAsyncShape) return;
		this._dataAsyncShape = true;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (this.data.constructor.name === 'AsyncFunction') return;
			const View = this.constructor;
			asyncShapeWarned ??= new WeakSet();
			if (asyncShapeWarned.has(View)) return;
			asyncShapeWarned.add(View);
			console.warn(
				`[puzzle] ${View.name}.data() is a plain function returning a Promise — declare it \`async\` so overlapping evaluations serialize`
			);
		}
	}

	/**
	 * Re-run data() and re-render — the router calls this on param changes,
	 * parents on prop changes, the store via onStoreChange. Queries inside
	 * data() re-subscribe through the store's tracking scope; a newer refresh
	 * supersedes an in-flight async one (stale results are discarded).
	 */
	refresh({ params, props, route } = {}) {
		// D146: a refresh runs against this view's COMMITTED params/route, so a
		// prepared async data() suspended on another route must not bleed its
		// destination scope into this run's data() through the getters.
		return this.#withCommittedScope(() => this.#refreshInner({ params, props, route }));
	}

	#refreshInner({ params, props, route } = {}) {
		if (this.#destroyed || this.#leaving) return;
		if (params) this.#params = params;
		if (props) this.#props = props;
		if (route !== undefined) this.#route = route;

		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (
				!devperfPrepareData(
					this,
					params || route !== undefined
						? 'route'
						: props !== undefined
							? 'props'
							: undefined
				)
			)
				return;
		}
		const token = ++this.#runToken;
		const run = () => {
			const out =
				typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__
					? devperfRunData(this, this.#params, this.#props)
					: this.data(this.#params, this.#props);
			if (out && typeof out.then === 'function') this.#noteAsyncShape();
			return out;
		};
		const store = this.ctx.store;
		const expectsAsync = this._dataAsyncShape || this.data.constructor.name === 'AsyncFunction';
		let result;
		if (!store) {
			result = run();
		} else if (!store._a || !this._settleData) {
			// No adapter capability on THIS app's store: no query can fault, so this is
			// the single-evaluation path it has always been, and without the capability
			// anywhere in the realm the settle loop is not even in the bundle (D157
			// boundary — the capability installs it).
			//
			// The seam is the STORE's capability, not `_settleData`'s presence.
			// install() copies the methods onto the shared prototypes once per realm
			// and never removes them (concurrent apps depend on that), so an app
			// mounted after an adapter app would otherwise inherit the settle path and
			// fault reads it deliberately opted out of.
			result = store.withTracking(this, run, expectsAsync);
		} else {
			// The loop owns the settle window it opens under `token`, so this stays one
			// call and the commit tail below is the same one it always was.
			result = this._settleData(
				store,
				run,
				expectsAsync,
				() => this.#destroyed || this.#leaving || token !== this.#runToken,
				null,
				token
			);
		}

		if (result && typeof result.then === 'function') {
			return result.then((model) => this.#commit(token, model));
		}
		this.#commit(token, result);
	}

	/**
	 * INTERNAL — the D161 settle loop, ATTACHED by the adapter capability and absent
	 * without it: `_settleData(store, run, expectsAsync, isStale, parked, token)`
	 * re-runs data() until a pass queries nothing it has to fetch, then returns that
	 * pass's model (synchronously when the first pass was synchronous and clean).
	 * With a `token` it also owns `_settlingToken`/`_settleDirty` — the window
	 * onStoreChange below folds a notification into — for that run's lifetime.
	 * Every entry point (refresh, preload, prepareRefresh, nested and skeleton
	 * mounting, prerender, static mounting) reaches the one implementation.
	 */

	/**
	 * TRANSACTIONAL refresh (D146) — the two-phase form the router uses for a REUSED
	 * ancestor inside a gated navigation. PREPARE runs data() against the destination
	 * params/route (visible to the run through the params/route getters) and captures
	 * both the model result and the store subscriptions the run tracked; it renders
	 * nothing and mutates no committed field. The returned handle then either
	 *
	 *   commit()  — swap params/route/model/subscriptions and re-render, or
	 *   discard() — drop only the subscriptions this run added, leaving the view's
	 *               committed params, route snapshot, data, DOM, and live
	 *               subscription set exactly as they were.
	 *
	 * so a navigation that rejects or is superseded leaves the ancestor entirely on
	 * the old route (closing the D19/D30 soft-violation).
	 *
	 * Returns null when there is nothing to prepare (destroyed/leaving view, or a
	 * profiler-blocked data() run) — the same no-op refresh() performs in those
	 * states; the caller simply has nothing to commit.
	 *
	 * A SYNCHRONOUS data() throw propagates out of this call exactly as it does out
	 * of refresh() (withTracking rethrows), already reconciled as a failure.
	 *
	 * @returns {?{ready: Promise<void>, commit: function(): void, discard: function(): void}}
	 */
	prepareRefresh({ params, props, route } = {}) {
		if (this.#destroyed || this.#leaving) return null;

		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (
				!devperfPrepareData(
					this,
					params || route !== undefined
						? 'route'
						: props !== undefined
							? 'props'
							: undefined
				)
			)
				return null;
		}

		const scope = {
			params: params ?? this.#params,
			props: props ?? this.#props,
			route: route !== undefined ? route : this.#route,
		};
		// The held-eval channel: withTracking parks its success reconcile here instead
		// of applying it, so the subscription swap lands with the commit (or is
		// unwound by the discard) rather than at evaluation time.
		const pending = {};

		// Establish/retire #evalScope around EVERY invocation (withTracking may retry
		// fn behind an in-flight async chain) and across the async tail.
		//
		// THE INVARIANT: #evalScope is the most recently installed evaluation that is
		// still IN FLIGHT, and null once they have all unwound. That is why the unwind
		// target is derived from #evalRuns at retire time rather than captured up
		// front — neither capture point is correct on its own:
		//
		//   • Per INVOCATION is wrong for a retry. withTracking may abandon an
		//     invocation mid-flight and re-run the same prepare behind the busy chain;
		//     the retry would capture the abandoned invocation's still-installed scope
		//     and, since that abandoned tail resolves later and finds itself no longer
		//     on top, restore a scope nothing will ever retire.
		//   • Once per PREPARE is wrong for OVERLAP. A prepare created while an
		//     earlier prepare is suspended captures that earlier scope, but the store
		//     serializes async evaluations, so it does not actually run until the
		//     earlier one has already unwound — restoring to it resurrects a
		//     destination that never committed and pins params/route there for the
		//     life of the view.
		//
		// Retiring by identity out of #evalRuns is correct under either ordering: an
		// abandoned invocation settling late is removed from the middle and leaves the
		// live top alone, and the last one out always lands on null. Each invocation
		// still installs its OWN copy of `scope` — commit() below reads the outer
		// object — so entries stay distinguishable by identity.
		const run = () => {
			const mine = this.#beginEvalRun(scope);
			let out;
			try {
				out =
					typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__
						? devperfRunData(this, scope.params, scope.props)
						: this.data(scope.params, scope.props);
			} catch (err) {
				this.#endEvalRun(mine);
				throw err;
			}
			if (out && typeof out.then === 'function') {
				this.#noteAsyncShape();
				return out.then(
					(model) => {
						this.#endEvalRun(mine);
						return model;
					},
					(err) => {
						this.#endEvalRun(mine);
						throw err;
					}
				);
			}
			this.#endEvalRun(mine);
			return out;
		};

		const store = this.ctx.store;
		const expectsAsync = this._dataAsyncShape || this.data.constructor.name === 'AsyncFunction';
		// D161: a prepared run settles through the same loop. Intermediate passes are
		// discarded as they are anywhere else; the FINAL pass's reconcile is parked on
		// `pending`, so commit()/discard() below are unchanged. Store notifications
		// are NOT coalesced here — while the gate is open the ancestor still shows its
		// committed route and must keep taking live updates (D146). Gated on the
		// STORE's capability for the same realm-leak reason as #refreshInner above.
		const result = !store
			? run()
			: store._a && this._settleData
				? this._settleData(
						store,
						run,
						expectsAsync,
						() => this.#destroyed || this.#leaving,
						pending
					)
				: store.withTracking(this, run, expectsAsync, pending);

		let model;
		const ready = Promise.resolve(result).then((m) => {
			model = m;
		});

		// The token this prepare was evaluated against. Any COMMITTED refresh landing
		// between here and commit() bumps it, which is exactly the "the prepared model
		// is older than what is on screen" signal commit() converges on.
		const preparedAt = this.#runToken;

		let settled = false;
		return {
			ready,
			commit: () => {
				if (settled) return;
				settled = true;
				// Torn down between prepare and commit: unwind the prepared subscriptions
				// and touch nothing else (destroy() already dropped this subscriber).
				if (this.#destroyed || this.#leaving) {
					pending.reconcile?.(false);
					return;
				}
				pending.reconcile?.(true);
				this.#params = scope.params;
				this.#props = scope.props;
				this.#route = scope.route;
				// Bumping the token HERE (not at prepare) is what orders this commit
				// against a mid-gate store-change refresh: while the gate is open the
				// ancestor still shows the OLD route, so such a refresh runs and renders
				// normally with the old params, and the bump below supersedes any of
				// those still in flight — their params are stale by definition.
				//
				// But the prepared model is NOT automatically the newest state. A refresh
				// that started (and possibly landed) after this prepare saw store data the
				// prepared model predates — the D146 gate is exactly the window in which a
				// user edit to a record the ancestor derives from can land. Committing the
				// captured model then reverts the view to a pre-edit value and leaves it
				// there until some unrelated later write. So: adopt the destination
				// params/route/subscriptions either way, but when the token moved, RE-DERIVE
				// instead of painting the stale capture. Costs one extra data() run and one
				// tick of the older value on the rare interleaving; the alternative is
				// indefinitely stale content.
				if (this.#runToken !== preparedAt) {
					this.#runToken++; // supersede anything still in flight
					// Fire-and-forget, contained exactly like the store-change path: a
					// data() failure here must not escape into the router's synchronous
					// commit window (where it would strand the swap half-applied).
					try {
						this.refresh()?.catch((err) =>
							this.#handleBackgroundRefreshFailure(
								'[puzzle] data() failed during a prepared-commit re-derive:',
								err
							)
						);
					} catch (err) {
						this.#handleBackgroundRefreshFailure(
							'[puzzle] data() failed during a prepared-commit re-derive:',
							err
						);
					}
				} else {
					// Contained exactly like the re-derive arm above, and for the same
					// reason: this runs inside the router's SYNCHRONOUS commit window,
					// after #commitLocation. A render() throwing here — the ordinary
					// `{ user.name }` null-deref when the new id has no record — would
					// otherwise escape into #commitState with the URL and router.current
					// already moved, reject push() with a raw TypeError, abort the commit
					// loop before the remaining prepared ancestors adopt their destination
					// params, and mount no error view at all (D61 atomicity and D145
					// containment broken together). Every other refresh() caller funnels;
					// so does this one.
					try {
						this.#commit(++this.#runToken, model);
					} catch (err) {
						this.#handleViewFailure(
							'[puzzle] render failed during a prepared commit:',
							err,
							'refresh'
						);
					}
				}
			},
			discard: () => {
				if (settled) return;
				settled = true;
				// Subscription-only unwind: drops just this run's own additions. No
				// render, no lifecycle hook, no error-boundary/onStoreChange side effect —
				// a discarded prepare must be invisible to the app (D145).
				pending.reconcile?.(false);
			},
		};
	}

	/** Store subscription callback (Store.flush → subscribed components). */
	onStoreChange() {
		// D146: a store flush landing mid-gate is committed-state work (see
		// #withCommittedScope) — refresh() fences its own body, but the reportError
		// context and the boundary funnel below read this.route too.
		return this.#withCommittedScope(() => this.#onStoreChangeInner());
	}

	#onStoreChangeInner() {
		if (this.#destroyed || this.#leaving) return;
		// D161: a notification landing while this view is settling folds into that
		// run — it takes one more pass before committing. Refreshing here instead
		// would supersede the settle, and the caller awaiting it (router preload,
		// mount) would resolve with no model ever committed.
		if (this._settlingToken !== 0) {
			this._settleDirty = true;
			return;
		}
		// Fire-and-forget: a data() failure on the store-change path is logged
		// rather than escaping into Store.flush() (where an uncaught throw would
		// abort delivery to every later subscriber). A rejecting ASYNC data() comes
		// back through refresh()'s promise (.catch); a SYNC throw comes straight
		// back OUT of refresh() — withTracking rethrows sync errors so router/mount
		// still see them — so the try/catch catches it here too. refresh() returns
		// undefined on the sync path (or when destroyed) — hence the optional chain.
		// refresh()'s own return is unchanged: mount()/preload() await it and must
		// keep seeing rejections.
		try {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				devperfMarkCause(this, 'store');
			}
			this.refresh()?.catch((err) =>
				this.#handleBackgroundRefreshFailure(
					'[puzzle] data() failed during a store-change refresh:',
					err
				)
			);
		} catch (err) {
			this.#handleBackgroundRefreshFailure(
				'[puzzle] data() failed during a store-change refresh:',
				err
			);
		}
	}

	/**
	 * Contain a fire-and-forget refresh failure. Normally logging is enough, but
	 * an anchor-race mount whose superseding first render failed can never reach
	 * #completeMount(). Recover through the same instance-owned placeholder
	 * contract mountComponent uses so the next parent patch creates a fresh view.
	 *
	 * Router-preloaded views never set #pendingMountHook: preload() resolves before
	 * their synchronous mount, so Router ownership remains untouched.
	 */
	#handleBackgroundRefreshFailure(message, err) {
		this.#handleViewFailure(message, err, 'refresh');
	}

	#handleViewFailure(message, err, phase) {
		const info = reportError(
			this.ctx,
			err,
			{ phase: this.__errorViewFailed ? 'error-view' : phase, view: this, route: this.route },
			message,
			err
		);
		if (this.__errorViewFailed) {
			const marker = this.#plantFailurePlaceholder();
			this.__errorViewFailed();
			marker?.remove();
			return;
		}
		if (this.#pendingMountHook) {
			this.#pendingMountHook = false;
			this.#enterPending = false;
		}
		this.__showErrorView(err, info);
	}

	/**
	 * Tear down: unsubscribe, clear DOM, fire destroyed(). Idempotent, and it
	 * stays SYNCHRONOUS and INSTANT — every existing caller (router error paths,
	 * plain unmount) keeps working. Any in-flight enter/leave animation is
	 * cancelled so a concurrent playOut()/playIn() await resolves and cleans up
	 * without a double-destroy (constellation/doc/DOC-SPEC.md §12). For an
	 * ANIMATED teardown, call destroyAnimated() instead.
	 */
	destroy() {
		if (this.#destroyed) {
			this.#disposeFailurePosition();
			return;
		}
		this.#destroyed = true;
		// Dev HMR (constellation/doc/DOC-SPEC.md §27, D57): leave the live-view registry so a
		// snapshot never keys a torn-down instance. Paired with the mount() add.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) unregisterView(this);
		// Cancel a pending anti-flash hold (v1.20, D52) — same posture as the
		// mount-after-destroy guard: a torn-down instance must not render later.
		if (this.#holdTimer !== null) {
			clearTimeout(this.#holdTimer);
			this.#holdTimer = null;
		}
		// Scroll-triggered enter (v1.40, D73): disarm a pending IntersectionObserver
		// observation and resolve the pending #deferredEnter promise so its closures
		// don't leak — the held/playing enter animation is cancelled by the
		// #currentAnimation.cancel() below (its finished then resolves).
		this.#disarmObserver();
		this.#settleEnter();
		this._cancelOutAnimation();
		this.#currentAnimation?.cancel();
		this.#currentAnimation = null;
		this.ctx.store?.unsubscribe(this);
		this.#vm?.clear();
		// Null every element ref (v1.39, D72 / SPEC §38: "nulled on removal"). The
		// __ref removal setter bails while #destroyed is true, so #vm.clear()'s
		// teardown removals above leave this.refs pointing at now-detached DOM;
		// clear them here so a torn-down instance never hands out stale elements.
		for (const key of Object.keys(this.refs)) this.refs[key] = null;
		// A USER hook must never wedge the teardown cascade — a throw here would
		// propagate up through the parent's #vm.clear(), router.stop(), and
		// PuzzleApp.#teardown(), leaving the app half-torn-down. Same
		// logged/never-wedges posture as app.js's beforeUnmount guard. Stays
		// synchronous: a returned promise is not awaited (destroy() is sync).
		try {
			// D146: user code, fenced to committed params/route.
			this.#withCommittedScope(() => this.destroyed());
		} catch (err) {
			reportError(
				this.ctx,
				err,
				{ phase: 'unmount', view: this, route: this.route },
				'[puzzle] destroyed hook error:',
				err
			);
		}
	}

	// ---- hooks & overridables (SPEC §4 class contract) ---------------------------

	/** Component model. Compiled components and views override this. */
	data(params, props) {
		return {};
	}

	/** Attached by the compiler via prototype assignment; null = render nothing. */
	render() {
		return null;
	}

	created() {}
	mounted() {}
	beforeUpdate() {}
	afterUpdate() {}
	destroyed() {}

	/**
	 * Enter/leave lifecycle hooks (constellation/doc/DOC-SPEC.md §12, constellation/doc/DOC-SPEC.md §4).
	 * No-op base methods like the ones above — they are LIFECYCLE hooks, not
	 * animation callbacks, so they fire in order even when no `animations` field
	 * is declared (zero-duration semantics). Order:
	 *   show:  mounted() → viewWillShow() → in-animation → viewDidShow()
	 *   hide:  viewWillHide() → out-animation → viewDidHide() → destroyed()
	 */
	viewWillShow() {}
	viewDidShow() {}
	viewWillHide() {}
	viewDidHide() {}

	/**
	 * INTERNAL — does this instance actually OVERRIDE a hide hook? Component removal
	 * (viewManager's unmount) has to fire the hide sequence for a view that declares
	 * the hooks without an `animations.out`, and take the plain synchronous destroy()
	 * for one that declares neither. viewManager cannot ask that question itself: the
	 * import runs views → manager, so the base prototype is out of scope there.
	 * Compared against the base methods rather than tested for existence, since every
	 * instance inherits the no-op stubs above.
	 */
	get __hasHideHooks() {
		return (
			this.viewWillHide !== PuzzleView.prototype.viewWillHide ||
			this.viewDidHide !== PuzzleView.prototype.viewDidHide
		);
	}

	// ---- animation (constellation/doc/DOC-SPEC.md §12) ----------------------

	// A subclass MAY also declare an optional `transitionMode` field here,
	// colocated with `animations` (e.g. `transitionMode = 'overlap';`). It is
	// read ONLY by the Router (D65, constellation/doc/DOC-SPEC.md §33), and only
	// when this instance is the DESTINATION animator of a route transition —
	// never by the view itself, and never when this instance is the one being
	// left. It overrides the app-level `transitionMode` default; a route-level
	// `transitionMode` (routes.js) takes precedence over this field when both
	// are set. Applies to layout classes too (a layout is a PuzzleView
	// subclass). Not declared here — absent by default, base class never reads it.

	/**
	 * Play the enter sequence once, after the first real render has landed:
	 * viewWillShow() → `animations.in` (if declared) → viewDidShow(). The
	 * ViewManager chains this onto a component vnode's mount promise, so
	 * this.element is the rendered root (not the comment anchor) by the time it
	 * runs. Guarded to fire at most once per mount. Never throws to its caller
	 * beyond user-hook errors.
	 *
	 * Trigger modes (v1.40, D73, constellation/doc/DOC-SPEC.md §39). `animations.in`
	 * may carry `trigger: 'mount' | 'visible'`:
	 * - 'mount' (default, or the key absent): byte-identical to the pre-D73 path —
	 *   viewWillShow/viewDidShow bracket the enter that plays immediately here.
	 * - 'visible': the enter is HELD paused at its `from` keyframe and the
	 *   viewWillShow/viewDidShow pair DEFERS to bracket the ACTUAL reveal, which
	 *   fires the first time this.element scrolls into view (§39, #deferredEnter).
	 *   mounted() timing is UNCHANGED — it still fires at mount, before the reveal.
	 *   The returned promise stays pending until the reveal completes (or destroy;
	 *   all callers are fire-and-forget, and destroy() resolves it — no leak).
	 * Any degradation (no IntersectionObserver, prefers-reduced-motion, malformed
	 * spec, or an unknown trigger value) falls through to the 'mount' path so
	 * content is never stranded hidden.
	 * @returns {Promise<void>}
	 */
	async playIn() {
		if (this.#destroyed || this.#playedIn) return;
		if (this.#pendingMountHook) {
			this.#enterPending = true;
			return;
		}
		this.#playedIn = true;
		const spec = this.animations?.in;
		if (this.#useVisibleTrigger(spec)) {
			return this.#deferredEnter(spec);
		}
		this.viewWillShow();
		// release: true — after the enter completes, the animation is cancelled so
		// the element returns to stylesheet-driven state (its own hover transitions
		// and CSS animations keep working). Enter `to` keyframes should equal the
		// element's natural styled state, so the handback is invisible.
		await this.#runAnimation(spec, { release: true });
		// Destroyed mid-enter, or a leave preempted it (playOut cancels the enter, which
		// RESOLVES this await rather than rejecting) — either way the "show" sequence
		// never completed, so its closing hook must not fire into a teardown or a leave.
		if (this.#destroyed || this.#leaving) return;
		this.viewDidShow();
	}

	/**
	 * Whether `spec` opts into and qualifies for the D73 visible-trigger hold.
	 * Only a VALID spec explicitly asking for `trigger: 'visible'` in a supporting
	 * environment qualifies; every other case (malformed spec, absent/unknown/
	 * 'mount' trigger, no IntersectionObserver, reduced motion) returns false and
	 * playIn() takes the immediate mount path — the §39 hard rule that content is
	 * never stranded hidden. An unknown trigger value warns once per spec here.
	 */
	#useVisibleTrigger(spec) {
		// Malformed spec → false: the mount path's playAnimation() does the
		// warn/skip (no double warning, no hold, no defer).
		if (!isValidSpec(spec)) return false;
		if (this.#inTrigger(spec) !== 'visible') {
			// A `triggerAnchor` is meaningless without `trigger: 'visible'` (trigger
			// absent/'mount'/unknown). Warn once here — where trigger resolves — so a
			// spec carrying only `triggerAnchor` doesn't silently arm anything (D73).
			if (spec.triggerAnchor !== undefined) {
				warnOnceForSpec(
					spec,
					`animation in.triggerAnchor is ignored without trigger: 'visible'`
				);
			}
			return false;
		}
		// Degrade to mount behavior where the hold is unsupported or unwanted.
		if (typeof IntersectionObserver !== 'function') return false;
		if (prefersReducedMotion()) return false;
		return true;
	}

	/**
	 * Resolve the enter `trigger` to 'mount' | 'visible'. Absent or 'mount' →
	 * 'mount'; 'visible' → 'visible'; anything else warns once per spec object and
	 * falls back to 'mount' (§39 — an unknown value must never break rendering).
	 */
	#inTrigger(spec) {
		const t = spec.trigger;
		if (t === undefined || t === 'mount') return 'mount';
		if (t === 'visible') return 'visible';
		warnOnceForSpec(
			spec,
			`unknown animation in.trigger ${JSON.stringify(t)} (expected 'mount' or 'visible'); using 'mount'`
		);
		return 'mount';
	}

	/**
	 * Map `spec.triggerOffset` to an IntersectionObserver rootMargin (§39): the
	 * trigger line's distance ABOVE the viewport's bottom edge. A number is px
	 * ('0px 0px -<n>px 0px'); a string must match /^\d+(\.\d+)?(px|%)$/
	 * ('0px 0px -<n>% 0px'). Absent → no offset. An invalid value warns once per
	 * spec and is treated as absent. Threshold is always 0 (baked into the caller).
	 */
	#inRootMargin(spec) {
		const raw = spec.triggerOffset;
		if (raw === undefined || raw === null) return '0px 0px 0px 0px';
		if (typeof raw === 'number' && Number.isFinite(raw)) {
			return `0px 0px -${raw}px 0px`;
		}
		if (typeof raw === 'string' && /^\d+(\.\d+)?(px|%)$/.test(raw)) {
			return `0px 0px -${raw} 0px`;
		}
		warnOnceForSpec(
			spec,
			`invalid triggerOffset ${JSON.stringify(raw)} (expected a number or "<n>px"/"<n>%"); ignoring`
		);
		return '0px 0px 0px 0px';
	}

	/**
	 * Resolve the element to OBSERVE for a visible-trigger enter (D73 triggerAnchor).
	 * With no `triggerAnchor` the instance root `el` is observed as before. Otherwise
	 * the nearest ANCESTOR matching the selector — `el.closest(sel)` — is observed so
	 * a group of instances sharing one section reveal together. `closest` ALSO matches
	 * `el` itself when the element carries the selector; that degenerate self-match is
	 * fine and intentional (the element observes itself, identical to no anchor).
	 * Resolved ONCE, at arm time — never re-resolved. Any problem falls back to `el`
	 * (never stranded hidden, §39):
	 *   - not a non-empty string → warn once, observe `el`;
	 *   - `closest()` throws (invalid selector) or returns null (no ancestor) → warn
	 *     once, observe `el`.
	 * @param {object} spec the enter spec (already a valid, visible-trigger spec)
	 * @param {Element} el this instance's root (the animation target and fallback)
	 * @returns {Element} the element to observe
	 */
	#resolveAnchor(spec, el) {
		const sel = spec.triggerAnchor;
		if (sel === undefined) return el;
		if (typeof sel !== 'string' || sel.trim() === '') {
			warnOnceForSpec(
				spec,
				`invalid triggerAnchor ${JSON.stringify(sel)} (expected a non-empty CSS selector string); observing the element itself`
			);
			return el;
		}
		let anchor = null;
		try {
			anchor = el.closest(sel);
		} catch {
			// An invalid selector throws SyntaxError — degrade, don't break rendering.
			anchor = null;
		}
		if (!anchor) {
			warnOnceForSpec(
				spec,
				`no ancestor matches triggerAnchor ${JSON.stringify(sel)}; observing the element itself`
			);
			return el;
		}
		return anchor;
	}

	/**
	 * The scroll-triggered enter (v1.40, D73, §39). Creates the enter animation
	 * paused at its `from` keyframe NOW (fill: 'both' holds it — no flash of
	 * natural content), arms a shared IntersectionObserver on this.element, and on
	 * the FIRST intersection fires viewWillShow() → play → await → viewDidShow()
	 * (the "did" hook skipped if destroyed mid-enter). At most once per mount
	 * (playIn()'s #playedIn guard). The returned promise resolves when the reveal
	 * completes OR the view is destroyed/interrupted — never left forever-pending.
	 */
	#deferredEnter(spec) {
		const el = this.element;
		// Not a real element yet (async data() still in flight — the comment anchor):
		// the existing #runAnimation skip path applies. Hooks fire, no hold, no
		// observer — mirrors the mount path's element-missing behavior.
		if (!el || el.nodeType !== 1 /* ELEMENT_NODE */) {
			this.viewWillShow();
			this.viewDidShow();
			return Promise.resolve();
		}

		// Anchored group reveal (D73 triggerAnchor). Resolve the OBSERVED element ONCE
		// here — an ancestor matching `spec.triggerAnchor`, so many instances sharing a
		// section reveal together on one intersection. The hold/paused animation still
		// targets `el` (this instance's root); only the observed element changes, and
		// `triggerOffset` composes (the anchor is observed under the offset's
		// rootMargin). Falls back to `el` on any problem, so content is never stranded.
		const observed = this.#resolveAnchor(spec, el);

		// Hold the enter at `from` (release: true so it hands the element back once
		// revealed, like the normal enter). A degraded handle (pause() threw, no
		// WAAPI) still exposes play()/finished — the reveal just isn't held.
		const handle = playAnimation(el, spec, { release: true, paused: true });
		this.#currentAnimation = handle;

		return new Promise((resolve) => {
			this.#enterResolve = resolve;

			const reveal = () => {
				// Disarm first so a second intersection (scroll out and back) cannot
				// re-enter — the reveal happens at most once per mount.
				this.#disarmObserver();
				if (this.#destroyed) {
					this.#settleEnter();
					return;
				}
				// Both hooks are GUARDED here — unlike the mount path, where a throw
				// rejects playIn()'s promise and the caller logs it (viewManager
				// mountComponent's '[puzzle] child enter animation failed:', router
				// #playInLogged). This reveal fires from an IntersectionObserver
				// delivery, long after playIn() returned, so no caller can see the throw:
				// an unguarded viewWillShow() would skip handle.play() and leave the enter
				// held PAUSED at its `from` keyframe (typically opacity 0) — content
					// stranded hidden forever, the §39 hard rule this function exists to keep
					// — and both hooks would skip #settleEnter(), leaving playIn() pending.
					// Log and continue instead; the sequence is never aborted by a user hook.
					try {
						this.viewWillShow();
					} catch (err) {
						reportError(
							this.ctx,
							err,
							{ phase: 'enter', view: this, route: this.route },
							'[puzzle] enter hook failed during a visible-trigger reveal:',
							err
						);
					}
					handle.play();
				// handle.finished NEVER rejects — playAnimation normalises WAAPI's
				// cancel-time AbortError away (animate.js, "Cancellation resolves") — so
				// the only throw reachable in here is the user hook, guarded so
				// #settleEnter() below always runs. No .catch is needed on this chain.
				handle.finished.then(() => {
						if (this.#currentAnimation === handle) this.#currentAnimation = null;
						// Same rule as the mount path: destroyed OR preempted by a leave means
						// the reveal never completed, so its closing hook is skipped.
						if (!this.#destroyed && !this.#leaving) {
							try {
								this.viewDidShow(); // skipped entirely if destroyed mid-enter
							} catch (err) {
								reportError(
									this.ctx,
									err,
									{ phase: 'enter', view: this, route: this.route },
									'[puzzle] enter hook failed during a visible-trigger reveal:',
									err
								);
							}
						}
					this.#settleEnter();
				});
			};

			const disarm = observeVisible(observed, this.#inRootMargin(spec), reveal);
			if (!disarm) {
				// IO unsupported at observe time (e.g. observe() threw) — reveal now so
				// content is never stranded hidden (the §39 hard rule).
				reveal();
				return;
			}
			this.#disarmVisible = disarm;
		});
	}

	/** Stop a pending visible-trigger observation, if any (idempotent). */
	#disarmObserver() {
		if (this.#disarmVisible) {
			this.#disarmVisible();
			this.#disarmVisible = null;
		}
	}

	/** Resolve a pending #deferredEnter promise exactly once (no leak on destroy). */
	#settleEnter() {
		const resolve = this.#enterResolve;
		this.#enterResolve = null;
		if (resolve) resolve();
	}

	/**
	 * Unwind a pending visible-trigger enter (D73) when a leave/destroy preempts
	 * it: disarm the observer, cancel the held/playing enter animation (so its
	 * fill stops owning the element before an out animation runs on it), and
	 * resolve the pending playIn() promise. A no-op when no visible-trigger enter
	 * is pending — so the normal (mount-trigger) leave path is untouched.
	 */
	#abortEnter() {
		if (!this.#enterResolve && !this.#disarmVisible) return;
		this.#disarmObserver();
		this.#currentAnimation?.cancel();
		this.#currentAnimation = null;
		this.#settleEnter();
	}

	/**
	 * Suppress this instance's enter sequence (constellation/doc/DOC-SPEC.md §12,
	 * the one-animator rule). The Router calls this on the routed VIEW when it is
	 * mounted inside a FRESH layout during a layout swap: the layout animates the
	 * whole subtree as the unit, so the inner view must NOT also play in. After
	 * this, playIn() is a no-op (both its hooks and its animation are skipped) —
	 * the ViewManager's auto-chained slot-child playIn() therefore does nothing.
	 */
	skipEnter() {
		this.#enterPending = false;
		this.#playedIn = true;
	}

	/**
	 * Play the leave sequence: viewWillHide() → `animations.out` (if declared) →
	 * viewDidHide(). Memoised — a second call returns the same promise, and a
	 * destroy() during it cancels the animation so this resolves promptly (the
	 * "did" hook is skipped once destroyed, since destroy() fires destroyed()).
	 * The element stays in the DOM for the whole out-animation; the CALLER
	 * removes it afterwards (see destroyAnimated / ViewManager leave path).
	 * @returns {Promise<void>}
	 */
	playOut() {
		if (this.#leaving) return this.#leaving;
		if (this.#outTask) {
			// A restored view leaving for real. The out sequence is spent, so the
			// animation must not replay — but D136's leave-inertness rule is about the
			// LEAVE, not about the animation: re-arm #leaving and drop the subscription
			// this view re-took during recovery, or it stays reactive on its way out.
			//
			// The HOOKS are not spent with it. viewWillHide/viewDidHide are lifecycle,
			// not animation callbacks (D28), so a genuine departure fires them in order
			// with zero-duration semantics — exactly the treatment a view declaring the
			// hooks and no animation already gets. Without this, the only leave the user
			// ever really made fired neither hook and went straight to destroyed().
			// #outTask keeps naming the spent OUT so a third leave still skips the
			// animation; #leaving names this interval and carries the hook bracket.
			this.ctx.store?.unsubscribe(this);
			let resolveLeaving;
			let rejectLeaving;
			this.#leaving = new Promise((resolve, reject) => {
				resolveLeaving = resolve;
				rejectLeaving = reject;
			});
			// An async task, not a bare call: a throwing user hook must REJECT the
			// returned promise the way the full path does, never throw synchronously
			// out of playOut() — #startOverlapLeave passes this straight into a
			// Promise.all(), where a sync throw would escape its .catch entirely.
			const spentTask = (async () => {
				if (this.#destroyed) return;
				this.viewWillHide();
				await this.#runAnimation(undefined);
				if (this.#destroyed || !this.#leaving) return;
				this.viewDidHide();
			})();
			spentTask.then(resolveLeaving, rejectLeaving);
			return this.#leaving;
		}
		let resolveLeaving;
		let rejectLeaving;
		this.#leaving = new Promise((resolve, reject) => {
			resolveLeaving = resolve;
			rejectLeaving = reject;
		});
		this.#outTask = this.#leaving;
		// Leaving views become inert immediately. Store.flush() snapshots its
		// subscribers, so the method guards cover an already-snapshotted delivery;
		// unsubscribing here prevents every later one. destroy() repeats this safely.
		this.ctx.store?.unsubscribe(this);
		// A new leave replaces any retained, finished out effect from an earlier
		// run instead of accumulating another fill on the same root.
		this._cancelOutAnimation();
		const leavingTask = (async () => {
			if (this.#destroyed) return;
			// A held visible-trigger enter (D73) on this element must be unwound before
			// the out animation runs on the same element — cancel the hold, proceed.
			this.#abortEnter();
			// …and #abortEnter only covers a VISIBLE-trigger enter. A mount-trigger enter
			// still running is a live animation filling this same element (fill: 'both'),
			// so the out spec would run CONCURRENTLY with it and #currentAnimation would
			// simply be overwritten — the SPEC §12 one-animator rule. Cancel whatever
			// still owns the element before the leave starts. That resolves the enter's
			// finished promise (animate.js normalises WAAPI's cancel-time AbortError), so
			// the awaiting playIn() resumes; its viewDidShow is suppressed by the #leaving
			// check there.
			this.#currentAnimation?.cancel();
			this.#currentAnimation = null;
			// A `trigger`/`triggerOffset`/`triggerAnchor` on the OUT spec is meaningless
			// (leave is never scroll-gated) — warn once and ignore it; the leave path is
			// unchanged (D73).
			const out = this.animations?.out;
			if (
				out &&
				typeof out === 'object' &&
				(out.trigger !== undefined || out.triggerOffset !== undefined || out.triggerAnchor !== undefined)
			) {
				warnOnceForSpec(out, `animation out.trigger/out.triggerOffset/out.triggerAnchor is ignored (triggers apply to enter animations only)`);
			}
			this.viewWillHide();
			await this.#runAnimation(out, { retainOut: true });
			// Interrupted by destroy() — order preserved by it — or by
			// _restoreFromLeaving(), which cancels the out animation and so RESOLVES the
			// await above. A cleared #leaving means this view is back on screen, live and
			// re-subscribed: firing its closing hook there would announce a departure
			// that did not happen. The restore fires the SHOW bracket instead, and the
			// eventual real leave re-arms #leaving and fires the full hide bracket
			// through the spent-#outTask branch above.
			if (this.#destroyed || !this.#leaving) return;
			this.viewDidHide();
		})();
		leavingTask.then(resolveLeaving, rejectLeaving);
		return this.#leaving;
	}

	/**
	 * Router-only recovery seam: cancel the retained Puzzle-owned out animation,
	 * including a naturally finished effect still filling the root. Never
	 * enumerates Element.getAnimations(), so application-owned root motion is
	 * untouched. A no-op when this view never created an out animation.
	 */
	_cancelOutAnimation() {
		const handle = this.#outHandle;
		this.#outHandle = null;
		if (!handle) return;
		if (this.#currentAnimation === handle) this.#currentAnimation = null;
		handle.cancel();
	}

	/**
	 * Router-only failed-navigation recovery: make a committed outgoing view live
	 * again after playOut() made it inert. The out sequence remains spent through
	 * #outTask, so a later successful navigation still swaps this restored unit out
	 * instantly; only the active #leaving guard is cleared. Refresh after clearing
	 * it because playOut() unsubscribed the view — Store.withTracking inside refresh
	 * re-establishes exactly the queries data() still makes.
	 *
	 * playOut() fired viewWillHide() before its animation, so a restored view owes
	 * a SHOW bracket: it is on screen again, live and re-subscribed, and a view that
	 * stopped a timer in viewWillHide would otherwise stay frozen while visible.
	 * Hooks are lifecycle, not animation callbacks (D28), so the pair fires
	 * back-to-back with zero-duration semantics — the same treatment the D73
	 * visible-trigger path gives an enter it cannot hold, and the spent-#outTask
	 * branch of playOut() gives the hide bracket.
	 *
	 * Recovery runs inside the router's synchronous failure window. Contain the show
	 * hooks, a synchronous data() throw and an async rejection here so restoring the
	 * old view can never turn a handled navigation failure into a rejecting router
	 * promise.
	 */
	_restoreFromLeaving() {
		if (this.#destroyed || !this.#leaving) return;
		this.#leaving = null;
		this._cancelOutAnimation();
		// Guarded SEPARATELY, not as one bracket: the restart work a restored view
		// owes lives in viewDidShow (the timer viewWillHide stopped), so letting a
		// throwing viewWillShow skip it would leave exactly the frozen-while-visible
		// view this bracket exists to wake.
		this.#fireRestoreHook(() => this.viewWillShow());
		if (!this.#destroyed) this.#fireRestoreHook(() => this.viewDidShow());
		try {
			this.refresh()?.catch((err) =>
				this.#handleBackgroundRefreshFailure(
					'[puzzle] data() failed while restoring a stalled outgoing view:',
					err
				)
			);
		} catch (err) {
			this.#handleBackgroundRefreshFailure(
				'[puzzle] data() failed while restoring a stalled outgoing view:',
				err
			);
		}
	}

	/**
	 * Run one show hook from the restore path. Recovery runs inside the router's
	 * synchronous failure window, so a throw here must be reported and swallowed —
	 * never allowed to turn a handled navigation failure into a rejecting router
	 * promise, and never allowed to skip the hook that follows it.
	 */
	#fireRestoreHook(hook) {
		try {
			hook();
		} catch (err) {
			reportError(
				this.ctx,
				err,
				{ phase: 'enter', view: this, route: this.route },
				'[puzzle] show hook failed while restoring a stalled outgoing view:',
				err
			);
		}
	}

	/**
	 * Animated teardown: play the leave sequence, THEN destroy() (which removes
	 * the DOM and fires destroyed()). If already destroyed or there is no live
	 * element, it degrades to a plain synchronous destroy(). This is the only
	 * async teardown path — plain destroy() stays instant for existing callers.
	 * @returns {Promise<void>}
	 */
	async destroyAnimated() {
		if (this.#destroyed || !this.element) {
			this.destroy();
			return;
		}
		try {
			await this.playOut();
		} catch (err) {
			// A viewWillHide/viewDidHide user hook threw, rejecting playOut. Without
			// this guard destroy() below would be skipped: the DOM stays mounted and
			// the rejection is unhandled. Log it and STILL tear down — a rejected leave
			// must never strand the element on screen (mirrors the router overlap path's
			// leave-hook guard, router.js #startOverlapLeave). The destroyed-mid-playOut
			// interrupt path resolves (never rejects), so its early-return / did-hook-skip
			// semantics are untouched — only the throw path lands here.
			reportError(
				this.ctx,
				err,
				{ phase: 'leave', view: this, route: this.route },
				'[puzzle] leave hook failed during teardown:',
				err
			);
		}
		this.destroy();
	}

	/**
	 * Run one animation spec against this.element, tracking the live handle for
	 * cancellation. Resolves immediately (still async) when the spec is absent or
	 * the position is the comment anchor (data still in flight) — the surrounding
	 * hooks always fire regardless (constellation/doc/DOC-SPEC.md §12 hook order).
	 */
	async #runAnimation(spec, { release = false, retainOut = false } = {}) {
		if (!spec) return;
		const el = this.element;
		if (!el || el.nodeType !== 1 /* ELEMENT_NODE */) return;
		const handle = playAnimation(el, spec, { reducedMotion: prefersReducedMotion(), release });
		this.#currentAnimation = handle;
		if (retainOut) this.#outHandle = handle;
		await handle.finished;
		if (this.#currentAnimation === handle) this.#currentAnimation = null;
	}

	// ---- internals -----------------------------------------------------------

	#commit(token, model) {
		// superseded, torn down, or LEAVING — see #completeMount for why removal is
		// now asynchronous for any view declaring a hide hook (D136 §3).
		if (token !== this.#runToken || this.#destroyed || this.#leaving) return;
		// Two-layer state (Change C, SPEC §4). A successful data() result REPLACES the
		// model layer wholesale — keys an earlier run returned but this one omits
		// disappear (unless the local layer still holds them) — then #recompose()
		// rebuilds the visible #data as { ...#local, ...#model }. A non-object result
		// contributes no model (matching the pre-Change-C guard), yet still swaps
		// loaded + renders. Superseded/rejected runs returned above, touching neither
		// layer.
		if (model && typeof model === 'object') {
			this.#model = model;
			this.#recompose();
		}
		// Anti-flash hold (v1.20, D52). The FIRST data() result normally flips
		// #loaded and swaps the skeleton for the real template. If a skeleton was
		// actually shown and it has not yet been up for skeletonMinDuration ms,
		// HOLD the swap: keep the skeleton rendered, defer the loaded swap by the
		// remaining time. #loaded stays false during the hold, so every
		// !loaded-gated behavior (skeleton render, router #warnMissingSlots skip,
		// the view.loaded getter) stays consistent for free.
		if (!this.#loaded && this.#shouldHold()) {
			// Last-wins: the model is already merged above. A later commit landing
			// DURING the hold (store-change refresh, prop change) must NOT swap early
			// or re-arm the timer — the running timer fires ONE swap at expiry with
			// the latest #data, bracketed by beforeUpdate/afterUpdate.
			if (this.#holdTimer === null) {
				this.#holdTimer = setTimeout(() => {
					this.#holdTimer = null;
					if (this.#destroyed) return; // torn down mid-hold — no late render
					this.#swapLoaded();
				}, this.#holdRemaining());
			}
			return;
		}
		this.#swapLoaded();
	}

	/**
	 * Flip #loaded and render the real template — the loaded swap (v1.8, D39).
	 * Reached immediately on the first commit (no hold), at hold expiry (v1.20,
	 * D52), and on every post-load refresh.
	 */
	#swapLoaded() {
		// Reachable independently of #commit through the D52 hold timer, so it carries
		// the leave guard in its own right (D136 §3): a min-duration hold expiring
		// after the owner removed the view must not paint the real template over a
		// subtree that is on its way out.
		if (this.#destroyed || this.#leaving) return;
		this.#loaded = true;
		this.#renderNow();
		// Anchor-race gate (Change A): a superseded initial async mount() deferred its
		// mounted() until a first render actually committed — this is that commit, so
		// complete the mount now (AFTER #renderNow, so mounted() sees the real
		// element, and with #mounted still false through the render so it counts as
		// the first render, not an update). #completeMount is idempotent; the
		// non-deferred paths (flag false) are untouched.
		if (this.#pendingMountHook) {
			this.#pendingMountHook = false;
			this.#completeMount();
			if (this.#enterPending) {
				this.#enterPending = false;
				Promise.resolve(this.playIn()).catch((err) =>
					reportError(
						this.ctx,
						err,
						{ phase: 'enter', view: this, route: this.route },
						'[puzzle] child enter animation failed:',
						err
					)
				);
			}
		}
	}

	/**
	 * Rebuild the visible #data from the two layers (Change C): { ...#local,
	 * ...#model }. Mutates #data IN PLACE to keep it the one object setData writes to
	 * — drop keys no longer contributed by either layer, then assign the composition.
	 */
	#recompose() {
		const composed = { ...this.#local, ...this.#model };
		for (const key of Object.keys(this.#data)) {
			if (!(key in composed)) delete this.#data[key];
		}
		Object.assign(this.#data, composed);
		// Layer-clobber diagnostic (D147 hazard 4, dev only). A bare bind writes the
		// LOCAL layer, but the composition above puts the MODEL last — so a key data()
		// also derives from a record or prop is reverted the moment data() commits, and
		// the user's typing snaps back with nothing to explain it. The compiler cannot
		// see this (data() is opaque bytes, D03), so catch it here, against what the
		// commit ACTUALLY composed: a bind write's own commit compares equal in the
		// legitimate echo idiom (data() reads its own local back out through getData()
		// and returns it unchanged) and only differs when something really overwrote it.
		// Testing `key in #model` instead would flag every echo view in the corpus.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (this.#bindPending) {
				for (const [key, written] of this.#bindPending) {
					if (this.#data[key] === written || this.#bindWarned?.has(key)) continue;
					(this.#bindWarned ??= new Set()).add(key);
					console.warn(
						`[puzzle] a data() commit reverted the bound key '${key}' — bind the source ` +
							`path instead (value={ record.${key} }), or stop deriving '${key}' in data().`
					);
				}
				this.#bindPending.clear();
			}
		}
	}

	/**
	 * Whether the first loaded swap must be held (v1.20, D52): a skeleton was
	 * actually shown, a positive min-duration is declared, and the skeleton has
	 * not yet been up long enough. Compiled from `<puzzle-skeleton min-duration>`
	 * as a prototype assignment; absent → undefined → 0 → never holds (v1.8).
	 */
	#shouldHold() {
		return (this.skeletonMinDuration ?? 0) > 0 && this.#skeletonShownAt > 0 && this.#holdRemaining() > 0;
	}

	/** Milliseconds left before the anti-flash hold expires (v1.20, D52). */
	#holdRemaining() {
		return (this.skeletonMinDuration ?? 0) - (Date.now() - this.#skeletonShownAt);
	}

	/**
	 * Install a prepared evaluation's scope (D146) and return the entry that
	 * retires it. The entry is a fresh copy of `scope`, so overlapping invocations
	 * of the same prepare stay distinguishable by identity.
	 */
	#beginEvalRun(scope) {
		const mine = { ...scope };
		this.#evalRuns.push(mine);
		this.#evalScope = mine;
		return mine;
	}

	/**
	 * Retire one prepared evaluation. #evalScope falls back to whatever evaluation
	 * is still in flight — the newest one — or to null when this was the last, which
	 * is what keeps a superseded or abandoned invocation from being resurrected as
	 * some later invocation's unwind target (see the invariant in prepareRefresh).
	 * Idempotent: a tail that already retired its entry finds nothing to remove.
	 */
	#endEvalRun(mine) {
		const at = this.#evalRuns.lastIndexOf(mine);
		if (at === -1) return;
		this.#evalRuns.splice(at, 1);
		this.#evalScope = this.#evalRuns[this.#evalRuns.length - 1] ?? null;
	}

	/**
	 * Run fn with the DESTINATION eval scope (D146) fenced off, so `this.params` /
	 * `this.route` inside it report the COMMITTED route.
	 *
	 * #evalScope exists so a PREPARED data() run sees the navigation it is gating
	 * (D47). For a synchronous data() that window is one call frame. For an ASYNC
	 * one it spans the whole suspension — the entire navigation gate — during which
	 * the ancestor is still mounted, still on the old route, and fully interactive.
	 * Every path where the runtime re-enters app code from the event loop in that
	 * window must therefore read committed state, or a click handler doing
	 * `store.upsert('item', { listId: this.params.listId })` writes against a route
	 * the user has not navigated to (and which may never commit).
	 *
	 * Fenced here: renders, DOM event dispatch, flushUpdates (the setData path),
	 * onStoreChange, refresh, and the mounted()/destroyed() lifecycle hooks
	 * (beforeUpdate/afterUpdate run inside #renderNow, already fenced). NOT fenced,
	 * and a known residue: app code that captures `this` into a setTimeout or a
	 * fetch().then() DURING the gate and dereferences params/route after the fence
	 * returns. There is no async-local scope primitive in the browser to close that.
	 *
	 * The restore target is the INVARIANT — the newest evaluation still in flight,
	 * or null — never the value captured on the way in, and for exactly the reason
	 * prepareRefresh derives its unwind target from #evalRuns. `fn` can START an
	 * evaluation inside the fence: an unguarded route reaches prepareRefresh
	 * synchronously from router.push() (an empty guard chain adds no await), so a
	 * DOM handler on view V that pushes a params-only navigation reusing V begins a
	 * prepared run whose data() suspends at its first await and returns here still
	 * live. Restoring a captured value would overwrite that live run's scope, and
	 * every params/route read after its await would report the committed route.
	 *
	 * Fences nest (flushUpdates fences its whole body and #renderNow fences again
	 * inside it), so only the OUTERMOST exit restores the invariant; an inner exit
	 * re-suppresses it, because leaving anything but null there would un-fence the
	 * rest of its enclosing body. What the depth count does not buy back: a run that
	 * BEGINS inside the fence installs its scope immediately, so everything after a
	 * synchronous router.push() in that same frame reads the destination. That is a
	 * residue of the same family as the setTimeout one above — the alternative is
	 * stranding the live run — and there is no browser primitive to close it.
	 */
	#withCommittedScope(fn) {
		this.#evalScope = null;
		this.#fenceDepth++;
		try {
			return fn();
		} finally {
			this.#fenceDepth--;
			this.#evalScope =
				this.#fenceDepth > 0 ? null : (this.#evalRuns[this.#evalRuns.length - 1] ?? null);
		}
	}

	/**
	 * INTERNAL bridge to #withCommittedScope for the ViewManager, which wraps every
	 * patch-managed DOM listener so the owner's handler runs against committed
	 * params/route. Underscore-prefixed by the codebase's internal convention.
	 */
	__withCommittedScope(fn) {
		return this.#withCommittedScope(fn);
	}

	#renderNow(preparedTree = undefined) {
		// D146: a render always draws COMMITTED state. A prepared data() run whose
		// promise is suspended leaves #evalScope set, so a render that lands inside
		// that window (a store-change refresh on this same view while the gate is
		// open) would otherwise read the destination params/route through the getters
		// and paint the route the router has not committed. Renders are synchronous,
		// so clearing and restoring around the whole render is exact.
		this.#withCommittedScope(() => this.#renderNowInner(preparedTree));
	}

	#renderNowInner(preparedTree = undefined) {
		if (!this.#vm || this.#destroyed) return;
		if (
			(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) &&
			!devperfCanRender(this)
		) {
			return;
		}
		// A render is landing NOW with the current state, so any frame #scheduleRender
		// armed is already satisfied — clear the flag so its rAF no-ops instead of
		// repeating this render with byte-identical state (a synchronous refresh() after
		// a setData used to render twice). Deliberately AFTER both bails: clearing above
		// them would silently drop a legitimately pending local-state render. A setData
		// later in this same tick sees the flag false and re-arms normally.
		this.#updateScheduled = false;
		const isUpdate = this.#mounted;

		if (isUpdate) this.beforeUpdate();
		// Before the first loaded swap, a declared skeleton stands in for the real
		// template (v1.8, D39) — only created()-seeded state is readable there.
		// renderSkeleton is compiled from <puzzle-skeleton> and attached by
		// prototype assignment, exactly like render().
		const showSkeleton = !this.#loaded && typeof this.renderSkeleton === 'function';
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfRenderPrepare(this);
			// A throwing render()/renderSkeleton()/patch would skip devperfRenderEnd and
			// strand the prepared mark's scope on devperf's stack — every later render in
			// the process would then pile onto that abandoned causal chain (and eventually
			// trip the recursion guard). The wrapper is dev-only: production folds this
			// branch out and calls the span directly.
			try {
				this.#renderSpan(preparedTree, showSkeleton);
			} catch (error) {
				devperfRenderCancel(this);
				throw error;
			}
		} else {
			this.#renderSpan(preparedTree, showSkeleton);
		}
		// Timestamp the FIRST actual skeleton render so the hold measures from when
		// the skeleton became visible, not from mount (v1.20, D52). Set once.
		if (showSkeleton && this.#skeletonShownAt === 0) this.#skeletonShownAt = Date.now();
		if (isUpdate) this.afterUpdate();
	}

	/**
	 * The instrumented span of one render: build the tree, then patch it in (or
	 * empty the view's DOM when a hand-written render() returns null). Everything
	 * between devperfRenderPrepare and devperfRenderEnd lives here so #renderNow can
	 * close the prepared mark on a throw without duplicating the body.
	 */
	#renderSpan(preparedTree, showSkeleton) {
		const tree =
			preparedTree !== undefined
				? preparedTree
				: showSkeleton
					? this.renderSkeleton()
					: this.render();
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfRenderTreeBuilt(this);
		}
		if (tree) {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				devperfRenderStart(this);
			}
			// A takeover-prepared tree was already slot-expanded while nested
			// components were preloaded. Hand that exact tree through instead of
			// repeating the expansion in ViewManager.
			this.#vm.render(tree, preparedTree !== undefined);
		} else if (this.#vm.currentTree) {
			// A HAND-WRITTEN render() that returned a tree before and returns null now
			// (compiled templates always emit a root vnode, so this is authored-view
			// territory) must EMPTY this view's DOM — leaving the previous render on
			// screen is a silent stale-content bug. clear() unmounts the live tree,
			// destroying nested component instances and firing ref removals, and leaves
			// the manager REUSABLE (currentTree/anchor both null, so a later render()
			// takes its first-mount branch again).
			//
			// Re-anchor at the SAME position afterwards, capturing the departing root's
			// nextSibling first: clear() alone would leave this.element null and drop the
			// spot, so a parent's insertion refs (patch()/patchComponent read
			// child.element) would go stale and the later truthy render would APPEND to
			// the end of a container it may share with siblings. The comment anchor is
			// exactly the placeholder mount() uses while async data() is in flight; the
			// next render mounts before it and removes it.
			//
			// Gated on currentTree: null on the FIRST render is a no-op (nothing mounted,
			// the mount-time anchor still holds the position) and repeated nulls never
			// stack up comment nodes.
			const ref = this.#vm.element?.nextSibling ?? null;
			this.#vm.clear();
			this.#vm.anchorAt(ref);
		}
		// Rebuilt member-target diagnostic (D147, dev only). __bind collected the
		// member objects this completed render actually used. Warn only when the
		// object that received the write never returned, exactly one replacement did,
		// and that replacement did not preserve the value. The completed-render fence
		// is load-bearing for loops: another row may be visited before the written row,
		// and warning at the first WeakMap miss would false-positive on that ordinary
		// traversal. Record writes never arm #bindMemberPending, so replacing a store
		// record remains silent. Consume every entry here; a later intentional object
		// replacement must not be blamed for an older write that already survived.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (this.#bindMemberPending) {
				for (const [memoKey, pending] of this.#bindMemberPending) {
					if (
						!pending.sawTarget &&
						pending.replacement != null &&
						!pending.ambiguous &&
						!this.#bindMemberWarned?.has(pending.key)
					) {
						(this.#bindMemberWarned ??= new Set()).add(pending.key);
						console.warn(
							`[puzzle] the object behind a bound path is rebuilt on every data() run, so the write is lost — ` +
								`return a stable object (this.memo(...)), or bind a record or a bare local key instead ` +
								`(key: '${pending.key}')`
						);
					}
					this.#bindMemberPending.delete(memoKey);
				}
			}
		}
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfRenderEnd(this);
		}
	}

	#scheduleRender() {
		if (!this.#mounted || this.#destroyed || this.#updateScheduled) return;
		this.#updateScheduled = true;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfRenderScheduled(this, 'local-state');
		}

		const schedule =
			typeof requestAnimationFrame === 'function'
				? requestAnimationFrame
				: (cb) => setTimeout(cb, 0);
		schedule(() => this.flushUpdates());
	}

	/**
	 * Apply a scheduled setData re-render now. A throwing user hook never
	 * wedges the scheduler (the flag clears first; the error is reported).
	 */
	flushUpdates() {
		// D146: the setData re-render path re-enters from a rAF/timer callback, which
		// can land inside a suspended prepared data()'s window. Fence the whole body
		// (not just the render) so the error context and boundary funnel below read
		// the committed route too.
		this.#withCommittedScope(() => {
			if (!this.#updateScheduled) return;
			this.#updateScheduled = false;
			try {
				this.#renderNow();
			} catch (err) {
				this.#handleViewFailure('[puzzle] render update failed:', err, 'render');
			}
		});
	}
}

export default PuzzleView;
