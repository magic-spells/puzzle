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
 * - setData() → re-render only, data() does NOT re-run
 */

import { ViewManager } from './viewManager.js';
import { playAnimation, prefersReducedMotion, isValidSpec, warnOnceForSpec } from './animate.js';
import { observeVisible } from './visibility.js';
import { registerView, unregisterView } from '../devstate.js';

// Dev HMR guard (constellation/doc/DOC-SPEC.md §27, D57): a live-view registry feeds the
// state snapshot/restore. Gated on the __PUZZLE_DEV__ build define (production
// DCEs the register/unregister calls, so the registry import tree-shakes away).
// Both gates spell the probe INLINE — a shared `const DEV` defeats esbuild's
// per-site constant folding across method scopes (see app.js) — so production
// DCEs the calls and the registry import tree-shakes away. An undefined
// define (unbundled vitest) reads as true.

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
	#vm = null;
	#mounted = false;
	// Anchor-race gate (Change A): set true when the non-skeleton async mount()
	// branch resumes to find its first render superseded (no commit landed) —
	// #completeMount() is then deferred to the first #commit that DOES render, so
	// mounted() never fires against the comment anchor. Cleared when it fires.
	#pendingMountHook = false;
	#destroyed = false;
	#updateScheduled = false;
	#runToken = 0;
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
	#leaving = null; // memoised playOut() promise — idempotent teardown
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
		this.ctx = ctx;
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
			return hit.value;
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
	 * The DOM node occupying this component's position (null before mount).
	 * While an async data() is in flight this is the anchor placeholder, so
	 * a parent's sibling insertion refs stay valid (constellation/doc/DOC-APP-ANATOMY.md §4).
	 */
	get element() {
		return this.#vm?.element ?? null;
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
		return this.#params;
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
		return this.#route;
	}

	// ---- lifecycle -------------------------------------------------------------

	/**
	 * Mount into a container element. Lifecycle: created → data() (awaited)
	 * → render → mounted (constellation/doc/DOC-VIEW-LIFECYCLE.md §3).
	 *
	 * A parent's ViewManager also calls this to mount a child component
	 * (constellation/doc/DOC-APP-ANATOMY.md §4): `children` is the slot content captured at the
	 * call site (rendered at the child's `<children/>`) and `ref` is the DOM node
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
		this.#vm = new ViewManager(container, this.ctx);
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
			this.#renderNow();
		} else {
			this.created();
			const pending = this.refresh();
			if (pending && typeof this.renderSkeleton === 'function') {
				// Skeleton + async data() (v1.8, D39): render the skeleton into the
				// reserved position NOW and resolve the mount — the real render
				// patches over it when data() commits. The mount promise no longer
				// waits on data, so a data() rejection surfaces here (logged), not to
				// the caller; the skeleton stays up.
				pending.catch((err) => console.error('[puzzle] data() failed behind a skeleton:', err));
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
					return this;
				}
			}
		}

		this.#completeMount();
		return this;
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
		if (this.#mounted || this.#destroyed) return;
		this.#mounted = true;
		// Dev HMR (constellation/doc/DOC-SPEC.md §27, D57): join the live-view registry at the
		// #mounted-true convergence point, so the snapshot can key and read this
		// instance's state. Removed in destroy().
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) registerView(this);
		this.mounted();
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
		if (this.#destroyed) return;
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
					console.error('[puzzle] data() failed during a parent prop update:', err)
				);
			} catch (err) {
				console.error('[puzzle] data() failed during a parent prop update:', err);
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
			this.#renderNow();
		}
	}

	/**
	 * Re-run data() and re-render — the router calls this on param changes,
	 * parents on prop changes, the store via onStoreChange. Queries inside
	 * data() re-subscribe through the store's tracking scope; a newer refresh
	 * supersedes an in-flight async one (stale results are discarded).
	 */
	refresh({ params, props, route } = {}) {
		if (this.#destroyed) return;
		if (params) this.#params = params;
		if (props) this.#props = props;
		if (route !== undefined) this.#route = route;

		const token = ++this.#runToken;
		const run = () => this.data(this.#params, this.#props);
		const result = this.ctx.store
			? this.ctx.store.withTracking(this, run, this.data.constructor.name === 'AsyncFunction')
			: run();

		if (result && typeof result.then === 'function') {
			return result.then((model) => this.#commit(token, model));
		}
		this.#commit(token, result);
	}

	/** Store subscription callback (Store.flush → subscribed components). */
	onStoreChange() {
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
			this.refresh()?.catch((err) =>
				console.error('[puzzle] data() failed during a store-change refresh:', err)
			);
		} catch (err) {
			console.error('[puzzle] data() failed during a store-change refresh:', err);
		}
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
		if (this.#destroyed) return;
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
		this.#currentAnimation?.cancel();
		this.#currentAnimation = null;
		this.ctx.store?.unsubscribe(this);
		this.#vm?.clear();
		// Null every element ref (v1.39, D72 / SPEC §38: "nulled on removal"). The
		// __ref removal setter bails while #destroyed is true, so #vm.clear()'s
		// teardown removals above leave this.refs pointing at now-detached DOM;
		// clear them here so a torn-down instance never hands out stale elements.
		for (const key of Object.keys(this.refs)) this.refs[key] = null;
		this.destroyed();
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
		if (this.#destroyed) return; // destroyed mid-enter — skip the "did" hook
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
				this.viewWillShow();
				handle.play();
				handle.finished.then(() => {
					if (this.#currentAnimation === handle) this.#currentAnimation = null;
					if (!this.#destroyed) this.viewDidShow(); // skip if destroyed mid-enter
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
		this.#leaving = (async () => {
			if (this.#destroyed) return;
			// A held visible-trigger enter (D73) on this element must be unwound before
			// the out animation runs on the same element — cancel the hold, proceed.
			this.#abortEnter();
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
			await this.#runAnimation(out);
			if (this.#destroyed) return; // interrupted by destroy() — order preserved by it
			this.viewDidHide();
		})();
		return this.#leaving;
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
			console.error('[puzzle] leave hook failed during teardown:', err);
		}
		this.destroy();
	}

	/**
	 * Run one animation spec against this.element, tracking the live handle for
	 * cancellation. Resolves immediately (still async) when the spec is absent or
	 * the position is the comment anchor (data still in flight) — the surrounding
	 * hooks always fire regardless (constellation/doc/DOC-SPEC.md §12 hook order).
	 */
	async #runAnimation(spec, { release = false } = {}) {
		if (!spec) return;
		const el = this.element;
		if (!el || el.nodeType !== 1 /* ELEMENT_NODE */) return;
		const handle = playAnimation(el, spec, { reducedMotion: prefersReducedMotion(), release });
		this.#currentAnimation = handle;
		await handle.finished;
		if (this.#currentAnimation === handle) this.#currentAnimation = null;
	}

	// ---- internals -----------------------------------------------------------

	#commit(token, model) {
		if (token !== this.#runToken || this.#destroyed) return; // superseded
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

	#renderNow() {
		if (!this.#vm || this.#destroyed) return;
		const isUpdate = this.#mounted;

		if (isUpdate) this.beforeUpdate();
		// Before the first loaded swap, a declared skeleton stands in for the real
		// template (v1.8, D39) — only created()-seeded state is readable there.
		// renderSkeleton is compiled from <puzzle-skeleton> and attached by
		// prototype assignment, exactly like render().
		const showSkeleton = !this.#loaded && typeof this.renderSkeleton === 'function';
		const tree = showSkeleton ? this.renderSkeleton() : this.render();
		if (tree) this.#vm.render(tree);
		// Timestamp the FIRST actual skeleton render so the hold measures from when
		// the skeleton became visible, not from mount (v1.20, D52). Set once.
		if (showSkeleton && this.#skeletonShownAt === 0) this.#skeletonShownAt = Date.now();
		if (isUpdate) this.afterUpdate();
	}

	#scheduleRender() {
		if (!this.#mounted || this.#destroyed || this.#updateScheduled) return;
		this.#updateScheduled = true;

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
		if (!this.#updateScheduled) return;
		this.#updateScheduled = false;
		try {
			this.#renderNow();
		} catch (err) {
			console.error('[puzzle] render update failed:', err);
		}
	}
}

export default PuzzleView;
