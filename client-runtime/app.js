/**
 * PuzzleApp — the application class (constellation/doc/DOC-SPEC.md §1–§2, constellation/doc/DOC-APP-ANATOMY.md §3).
 *
 * Instantiate once with the v1 config surface and call `mount()`. The config
 * surface is frozen (SPEC §2): { target, routes, models, formatters, apiURL,
 * storage }, amended by v1.5 with { scrollBehavior } (D33), v1.6 with
 * { routerMode } (D34), v1.11 with { routerInitialPath } (memory mode only,
 * D42), v1.19 with { routerBase } (sub-path deploys, D51), v1.24 with
 * { transitionMode } (overlapping route transitions, D56), v1.31 with
 * { beforeMount, mounted, beforeUnmount } (app lifecycle hooks, D66), and v1.56
 * with { focusBehavior } (router focus + route announcement, D93).
 * Everything else (app-level settings/computed/events/methods) stays deferred
 * post-v1 (re-rejected at the D66 triage — SPEC §34).
 *
 * The constructor stores config only — no side effects. `mount()` builds the
 * ownership chain (APP_ANATOMY §2–§3):
 *
 *   Store(models, {apiURL, storage}) ─┐
 *   FormatterRegistry (+ config)      ├─▶ ctx = { store, router, formatters }
 *   Router(routes)                    ─┘         │ injected into every view
 *   router.start(el, ctx)  → runs navigation #0 (initial paint)
 *
 * `app.store` and `app.router` are exposed as readable properties for debugging.
 */

import { Store } from './datastore/store.js';
import { makeFormatterRegistry } from './formatters.js';
import { Router } from './router/router.js';
import { snapshotToStorage, restoreStoreFromStorage, restoreViewsFromStorage } from './devstate.js';
import { devtoolsAppMounted, devtoolsAppUnmounted } from './devtools.js';

// Dev HMR guard (constellation/doc/DOC-SPEC.md §27, D57): gates the state-preserving reload
// hooks on the __PUZZLE_DEV__ build define — "false" in production, where
// MinifySyntax DCEs every guarded branch (the devstate import then tree-shakes
// away). Each gate spells the probe INLINE — a shared `const DEV` does NOT
// constant-propagate into class-method scopes (measured: it left dead
// `Z && …` guards in the production bundle), while the inline expression
// folds at every site; the only production residue is the inert empty
// __devSnapshot method. An undefined define (unbundled vitest, a foreign
// bundler) reads as true — hooks present but inert — and the undeclared
// identifier is never dereferenced (typeof guards the `||`).

export class PuzzleApp {
	// Backing field for the `store` accessor. Null until mount() creates the Store
	// (and again after unmount()); the getter throws while unset so glue code that
	// reads app.store before mount() fails loudly at the cause instead of silently
	// capturing undefined (the pyramid-puzzle wire-before-mount trap).
	#store = null;

	// Morph handler stash (v1.23, D55): the Router is only constructed inside
	// mount(), so enableMorph(app) — which apps naturally call right after
	// `new PuzzleApp(...)` — can't reach app.router yet. setMorphHandler()
	// stashes here pre-mount and mount() forwards it when the router exists;
	// re-mounts re-apply it (unmount() drops the router, not the stash).
	#morphHandler = null;

	// pagehide → Store.flush() listener (bound per mount, removed in #teardown).
	// Batched persistence (D63) leaves a dirty window between a mutation and the
	// scheduled flush (next rAF / fallback timer); a reload or programmatic
	// navigation inside that window would unload before the write lands. pagehide
	// is the last reliable lifecycle signal (fires on unload AND bfcache entry,
	// where beforeunload is unreliable on mobile), so it forces the write out.
	#pageHideFlush = null;

	// Mount generation (v1.31 lifecycle, D66). mount() is async, so every
	// continuation after an await must answer "is MY mount still the live one?" —
	// a question the _mounted BOOLEAN cannot answer, because it only records
	// whether SOMETHING is mounted. An unmount() during an awaited beforeMount (or
	// during router.start()) flips it false and tears down; a fresh mount() then
	// flips it true again; the FIRST mount's continuation resumes, reads `true`,
	// and proceeds against the NEW cycle's router/ctx — re-starting an already
	// started router, restoring HMR state onto another cycle's tree, firing
	// `mounted` a second time, or (on the beforeMount abort path) tearing the
	// newer cycle down. So each mount() attempt claims a monotonic epoch and
	// #teardown() burns the current one: `this.#mountEpoch !== epoch` is the
	// authoritative staleness test — true iff anything tore down or re-mounted
	// since this attempt began. The _mounted flag stays the "is anything mounted"
	// question it always was (unmount()'s idempotency guard, the abort read).
	#mountEpoch = 0;

	/**
	 * @param {object} config the frozen v1 surface (SPEC §2)
	 * @param {string|Element} config.target CSS selector or Element to mount into
	 * @param {Array} [config.routes] route definitions
	 * @param {object} [config.models] type name → model class registry
	 * @param {object} [config.formatters] app-level template formatters (override built-ins)
	 * @param {string} [config.apiURL] base URL for the D21 server read path
	 * @param {object} [config.storage] Storage-like object for persistence (opt-in)
	 * @param {Function} [config.beforeRequest] adapter request hook (v1.55, D91):
	 *   `beforeRequest(init, { type, method, url })`, called SYNCHRONOUSLY before
	 *   every adapter fetch (`loadAll`/`loadOne`, `save()`, `delete()`,
	 *   `request()`). Mutate `init` in place or return a replacement object to
	 *   attach auth headers, `credentials`, or an AbortSignal; the context arg is
	 *   frozen, and `method`/`body` are re-stamped by the Store (a hook cannot
	 *   change the verb or payload, which the D50 write path depends on). A throw
	 *   rejects the calling verb — no request is sent
	 * @param {false|Function} [config.scrollBehavior] router scroll handling
	 *   (v1.5, D33): omit for the default (top on push, restore on back/forward);
	 *   `false` to leave scroll alone; `(to, from, savedPosition) => {x,y}|null`
	 *   to customize per navigation
	 * @param {false|Function} [config.focusBehavior] router focus management +
	 *   route announcement (v1.56, D93): omit for the default (after every
	 *   committed navigation, focus the leaf view's root with
	 *   `{ preventScroll: true }` and announce the committed `document.title` in a
	 *   framework-owned visually-hidden `aria-live="polite"` region); `false` to
	 *   disable both — no focus move and no live region at all;
	 *   `(to, from) => Element|null|false` to choose the target, called after the
	 *   new content is mounted so it may query the committed DOM (a falsy return
	 *   skips focusing for that navigation, a throw is logged and treated as
	 *   falsy). Inert in memory mode, like `scrollBehavior`
	 * @param {('history'|'hash'|'memory')} [config.routerMode] router URL carrier
	 *   (v1.6, D34; v1.11, D42): omit/`'history'` for pathname routing, `'hash'` for
	 *   `location.hash` routing on static hosts, `'memory'` for URL-less routing in
	 *   router state (tests/embeds)
	 * @param {string} [config.routerInitialPath] memory mode only (v1.11, D42): the
	 *   first route, default `'/'` (there is no URL to read). A constructor throw in
	 *   history/hash mode — the URL is the initial path there
	 * @param {string} [config.routerBase] serve the app under a sub-path (v1.19,
	 *   D51): `'/myapp'` (leading '/' ensured, trailing '/' trimmed; `''`/`'/'` = no
	 *   base). Carried on the URL only — routes, `push()`, `current`, `params`, and
	 *   `this.route` stay base-free. A base containing `'#'`/`'?'` is a constructor
	 *   throw; inert in memory mode (no URL)
	 * @param {('sequential'|'overlap')} [config.transitionMode] route transition
	 *   feel (v1.24, D56): omit/`'sequential'` for the default sequential swap
	 *   (old `out` finishes before the new view mounts), `'overlap'` to play the
	 *   old `out` and new `in` concurrently via fixed-pin positioning (SPEC §26)
	 * @param {Function} [config.beforeMount] app lifecycle hook (v1.31, D66):
	 *   `beforeMount(app)`, run inside mount() after the ctx services are wired
	 *   and BEFORE navigation #0 — AWAITED, so an async store seed lands before
	 *   the first `data()`. A throw/rejection aborts the mount (SPEC §34)
	 * @param {Function} [config.mounted] app lifecycle hook (v1.31, D66):
	 *   `mounted(app)`, run after the initial route has rendered (and the dev HMR
	 *   restore). NOT awaited; a throw/rejection is logged, never rejecting a
	 *   mount that succeeded (SPEC §34)
	 * @param {Function} [config.beforeUnmount] app lifecycle hook (v1.31, D66):
	 *   `beforeUnmount(app)`, run at the top of unmount() before any teardown
	 *   (services still live). Synchronous — a returned promise is not awaited; a
	 *   throw is logged and teardown proceeds. Does not fire on the beforeMount
	 *   abort path (SPEC §34)
	 */
	constructor(config = {}) {
		this.config = config;
		this.ctx = null;
		this.router = null;
		this.formatters = null;
		this._container = null;
		this._mounted = false;
	}

	/**
	 * The wired datastore — readable for debugging and for app-level glue that
	 * bridges an external client into the store. Available only once mount() has
	 * created it: reading it before mount() (or after unmount()) throws, so a
	 * consumer that captures it too early fails at the cause instead of silently
	 * holding undefined and throwing far downstream (the interleave idiom is
	 * `const p = app.mount(); wire(app.store); await p;` — app.store is a Store the
	 * moment mount() is CALLED, before its returned promise resolves).
	 */
	get store() {
		if (this.#store == null) {
			throw new Error(
				'[puzzle] app.store is not available until mount() has been called — wire store consumers after mount() starts'
			);
		}
		return this.#store;
	}

	/**
	 * Register the shared-element morph handler (v1.23, D55) — the app-level
	 * face of Router.setMorphHandler, safe to call before OR after mount()
	 * (pre-mount it is stashed and applied when mount() constructs the router).
	 * Called by enableMorph(app) from @magic-spells/puzzle/morph; pass null to
	 * unregister.
	 */
	setMorphHandler(handler) {
		this.#morphHandler = handler ?? null;
		this.router?.setMorphHandler(this.#morphHandler);
		return this;
	}

	/**
	 * Boot the app (APP_ANATOMY §3). Resolves the target, wires the three ctx
	 * services, and runs the initial navigation. Returns a promise that resolves
	 * to `this` once the initial route has rendered (router.start is async).
	 */
	async mount() {
		if (this._mounted) return this;

		// SSG importability (M1): a user `app/app.js` calls `app.mount()` at top
		// level, so the prerender bundle imports that module under Node — where
		// there is no DOM to mount into. Bail as a no-op there (nothing to render
		// build-side; the SSG path drives the config, not a live mount) so the
		// module is importable. In the browser `document` is defined and mount()
		// proceeds exactly as before — non-SSG behavior is untouched.
		if (typeof document === 'undefined') return this;

		// Claim this attempt's mount generation (see the #mountEpoch field comment).
		// AFTER the early-outs above — an already-mounted no-op must not burn the
		// epoch of the in-flight mount it is declining to redo — and before any
		// wiring, so every await below can compare against a token unique to this
		// attempt. A validation/target throw below leaves the epoch bumped, which is
		// correct: it can only invalidate continuations of cycles already torn down.
		const epoch = ++this.#mountEpoch;

		// App lifecycle hooks (v1.31, SPEC §34, D66): validate the three optional
		// config hooks up front, before any wiring. Nullish → treated as absent;
		// any other non-function value is a mount()-time throw (the constructor
		// stays a side-effect-free config store, SPEC §2, so the check lives here,
		// not in the constructor).
		for (const name of ['beforeMount', 'mounted', 'beforeUnmount']) {
			const hook = this.config[name];
			if (hook != null && typeof hook !== 'function') {
				throw new Error(`[puzzle] config.${name} must be a function when set`);
			}
		}

		const {
			target,
			routes = [],
			models = {},
			formatters = {},
			apiURL,
			storage,
			beforeRequest,
			scrollBehavior,
			focusBehavior,
			routerMode,
			routerInitialPath,
			routerBase,
			transitionMode,
			beforeMount,
			mounted,
		} = this.config;

		// 1. Resolve the mount element — a selector string or an Element.
		const el = this.#resolveTarget(target);
		this._container = el;

		// 2. Store: models registry in; pass storage through only when provided so
		//    the Store's own default (no persistence) stands otherwise. The adapter
		//    request hook (v1.55, D91) rides the same conditional convention.
		const storeOptions = { apiURL };
		if (storage !== undefined) storeOptions.storage = storage;
		if (beforeRequest !== undefined) storeOptions.beforeRequest = beforeRequest;
		this.#store = new Store(models, storeOptions);

		// 3. Formatters: shared built-in/custom wiring plus the live-router-backed
		//    `link` encoder. The closure reads this.router lazily so a re-mount never
		//    keeps a stale Router, and a custom `link` formatter still wins.
		this.formatters = makeFormatterRegistry(formatters, (path) =>
			this.router ? this.router.url(path) : path
		);

		// 4. Router + the shared context object injected into every view. Pass
		//    `mode` through only when routerMode is set, so the Router's own default
		//    ('history') stands otherwise — mirroring how `storage` is conditionally
		//    passed to the Store above (D34).
		const routerOptions = { scrollBehavior };
		// focusBehavior → Router `focusBehavior`, passed through ONLY when set so the
		// Router's own default (focus the committed leaf root + announce the title)
		// stands otherwise (v1.56, D93) — mirroring the conditional passthroughs below.
		if (focusBehavior !== undefined) routerOptions.focusBehavior = focusBehavior;
		if (routerMode !== undefined) routerOptions.mode = routerMode;
		// routerInitialPath → Router `initialPath`, passed through ONLY when set so
		// the Router's own default ('/') stands otherwise and the memory-only throw
		// stays fail-fast (a set value in history/hash mode is a constructor error,
		// D42) — mirroring the routerMode/storage conditional passthrough.
		if (routerInitialPath !== undefined) routerOptions.initialPath = routerInitialPath;
		// routerBase → Router `base`, passed through ONLY when set so the Router's own
		// default ('' — no base) stands otherwise (v1.19, D51) — mirroring the
		// routerMode/routerInitialPath conditional passthrough.
		if (routerBase !== undefined) routerOptions.base = routerBase;
		// transitionMode → Router `transitionMode`, passed through ONLY when set so
		// the Router's own default ('sequential' — byte-identical to v1.23) stands
		// otherwise (v1.24, D56) — mirroring the conditional passthroughs above.
		if (transitionMode !== undefined) routerOptions.transitionMode = transitionMode;
		this.router = new Router(routes, routerOptions);
		if (this.#morphHandler) {
			// Re-arm a handler disposed by a prior unmount() so a mount → unmount →
			// re-mount cycle restores morph's document click listener (morph.js arm()
			// is a no-op on a still-armed handler / a stub without it).
			this.#morphHandler.arm?.();
			this.router.setMorphHandler(this.#morphHandler);
		}

		this.ctx = { store: this.#store, router: this.router, formatters: this.formatters };

		// Claim mounted BEFORE the async start(): the initial navigation may await a
		// slow data(), and an unmount() during that window must actually tear down.
		// unmount() guards on this flag — were it still false here, the guard would
		// no-op and the pending navigation would later mount into a detached
		// container. Set after the target resolved + services wired, so a
		// target-resolution throw above still leaves the app un-mounted. This flag
		// answers "is anything mounted?" only; "is MY mount still the live one?" is
		// the epoch's job (see #mountEpoch) — the two are not interchangeable.
		this._mounted = true;

		// Land any batched storage write before the page can unload (see the
		// #pageHideFlush field comment). Registered once _mounted is claimed so
		// every abort path from here on runs #teardown(), which removes it; a
		// beforeMount-hook mutation below is already covered. flush() is a safe
		// no-op when the store is clean.
		if (typeof window !== 'undefined') {
			this.#pageHideFlush = () => this.#store?.flush();
			window.addEventListener('pagehide', this.#pageHideFlush);
		}

		// Dev HMR (constellation/doc/DOC-SPEC.md §27, D57): publish the running app so the
		// injected `puzzle dev` client can call __devSnapshot() right before it
		// reloads. Gated on the build define + a window (never in SSR-less tests
		// without a DOM); cleared in unmount().
		if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && typeof window !== 'undefined') {
			window.__PUZZLE_APP__ = this;
			// DevTools bridge (constellation/doc/DOC-SPEC.md §27, D100): register with the
			// extension hook when one is installed. Here — services wired, navigation
			// #0 not yet run — so the store/router are readable and every view mount
			// arrives as a live event. A no-op when no extension is present.
			devtoolsAppMounted(this);
		}

		// App lifecycle: beforeMount (v1.31, SPEC §34, D66). The three ctx services
		// are live and the mounted flag is claimed, but navigation #0 has NOT run —
		// so a store seed here lands before the first data(). AWAITED: an async hook
		// finishes before router.start(). A throw/rejection ABORTS the mount — tear
		// back down to the unmounted state and rethrow (mount() rejects; re-mounting
		// later is legal). This abort path must NOT fire beforeUnmount (which pairs
		// only with a completed mount), so it calls #teardown() directly. It must
		// also tear down only ITS OWN cycle: an unmount() during the in-flight hook
		// already tore us down (don't double-teardown), and a mount() after that
		// unmount owns the app now — destroying IT because our stale hook rejected
		// would kill a healthy cycle. The epoch comparison is what tells those apart
		// (the flag reads `true` in both cases); a stale rejection just propagates,
		// the newer cycle owns its own cleanup. Nothing is swallowed either way.
		if (beforeMount != null) {
			try {
				await beforeMount.call(this, this);
			} catch (err) {
				if (this.#mountEpoch === epoch && this._mounted) this.#teardown();
				throw err;
			}
		}

		// Staleness gate (see the #mountEpoch field comment). unmount() may have run
		// during an async beforeMount (SPEC §34) — its #teardown() dropped our
		// services and burned our epoch — and a NEWER mount() may already own the
		// app. Either way this continuation is stale: stay out, the router must never
		// (re-)start from here. `#mountEpoch !== epoch` is the load-bearing half; the
		// `!this._mounted` read stays as the plain torn-down case it always covered.
		if (this.#mountEpoch !== epoch || !this._mounted) return this;

		// Dev HMR restore, phase 1 (§27, D57; Change D): consume the one-shot blob
		// and transplant its STORE records BEFORE navigation #0, so nav #0's data()
		// queries see the restored records (the old single-phase restore ran after
		// start() — store-derived views rendered empty until the next mutation). The
		// returned blob carries the view-local state to phase 2 (below). Gate spelled
		// inline so production DCEs it and the devstate import tree-shakes away.
		let hmrBlob = null;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) hmrBlob = restoreStoreFromStorage(this);

		// 5. Start routing — registers listeners and runs navigation #0.
		await this.router.start(el, this.ctx);

		// The same staleness gate after start()'s initial navigation. unmount() may
		// have run while it awaited data(): its router.stop() invalidated the nav (it
		// abandoned without mounting) and dropped our services — and a newer mount()
		// may have wired fresh ones since. Stay out: do not re-wire anything, do not
		// restore HMR state onto another cycle's view tree, and do not fire `mounted`
		// for a mount that no longer owns the app. Everything below this line is
		// synchronous, so this single gate covers the phase-2 restore and the hook.
		if (this.#mountEpoch !== epoch || !this._mounted) return this;

		// Dev HMR restore, phase 2 (§27, D57; Change D): the view chain is now
		// mounted, so each saved view's LOCAL setData state (drafts, toggles) can be
		// restored onto its keyed counterpart. The store was already transplanted in
		// phase 1 (before nav #0); this consumes the same blob phase 1 handed back.
		// Fail-soft end to end — a null/corrupt/expired blob just cold-starts.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) restoreViewsFromStorage(hmrBlob);

		// App lifecycle: mounted (v1.31, SPEC §34, D66). The initial route is in the
		// DOM and the dev HMR state (D57) is restored, so both are visible here. NOT
		// awaited — a post-success hook must never turn into a spurious mount()
		// rejection (same "logged, never wedges" posture as morph-handler errors,
		// D55). Both a sync throw and an async rejection are caught and logged.
		if (mounted != null) {
			try {
				const ret = mounted.call(this, this);
				if (ret != null && typeof ret.then === 'function') {
					ret.catch((err) => console.error('[puzzle] mounted hook error:', err));
				}
			} catch (err) {
				console.error('[puzzle] mounted hook error:', err);
			}
		}
		return this;
	}

	/**
	 * Snapshot the running app's state to a one-shot sessionStorage blob for the
	 * state-preserving dev reload (constellation/doc/DOC-SPEC.md §27, D57) — the injected
	 * `puzzle dev` client calls this immediately before `location.reload()`, and
	 * the freshly booted app restores it at the end of mount(). No-op in
	 * production (DCE'd) and always fail-soft, so it can never wedge the reload.
	 */
	__devSnapshot() {
		// Positive gate so production DCE reduces this method to a no-op and the
		// snapshotToStorage import tree-shakes away (§27, D57).
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) snapshotToStorage(this);
	}

	/**
	 * Tear down: fire beforeUnmount (services still live), then stop routing,
	 * clear the container, and drop the wired services. Idempotent — safe to call
	 * when never mounted or already unmounted.
	 */
	unmount() {
		if (!this._mounted) return this;

		// App lifecycle: beforeUnmount (v1.31, SPEC §34, D66). Fires at the top of
		// unmount(), after the idempotency guard (so never on a never-mounted /
		// already-unmounted app) and BEFORE any teardown — services are still live,
		// so a persistence flush can read the store. Synchronous: a returned promise
		// is not awaited and cannot delay teardown; a throw is caught and logged and
		// teardown always proceeds. Read from config (not destructured in mount())
		// so a re-mounted instance re-fires it. It does NOT fire on the beforeMount
		// abort path — that calls #teardown() directly.
		const { beforeUnmount } = this.config;
		if (beforeUnmount != null) {
			try {
				// Synchronous: teardown does NOT await a returned promise. But a
				// returned thenable that REJECTS would otherwise be an unobserved
				// rejection (Change B) — observe it with the same logged/never-wedges
				// posture as the mounted hook. The sync throw is caught below.
				const ret = beforeUnmount.call(this, this);
				if (ret != null && typeof ret.then === 'function') {
					ret.catch((err) => console.error('[puzzle] beforeUnmount hook error:', err));
				}
			} catch (err) {
				console.error('[puzzle] beforeUnmount hook error:', err);
			}
		}

		this.#teardown();
		return this;
	}

	/**
	 * The teardown body proper — split out of unmount() (v1.31, D66) so the
	 * beforeMount-abort path in mount() can tear back down to the unmounted state
	 * WITHOUT firing beforeUnmount (which pairs only with a completed mount).
	 * Assumes _mounted is true; leaves the app fully unmounted.
	 */
	#teardown() {
		// Burn the current mount generation FIRST (see the #mountEpoch field
		// comment): every in-flight mount() continuation — ours or an older one — is
		// stale from here on, and a mount() started after this one claims a fresh
		// epoch that no earlier continuation can be confused with. Ahead of the
		// teardown body so nothing below can be undone by a continuation that still
		// believes it owns the app.
		this.#mountEpoch++;
		// Dev HMR (constellation/doc/DOC-SPEC.md §27, D57): retract the published app so a
		// stale reference can't outlive this instance — but only if it still points
		// at us (a re-mount elsewhere may have replaced it).
		if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && typeof window !== 'undefined' && window.__PUZZLE_APP__ === this) {
			window.__PUZZLE_APP__ = null;
		}
		// DevTools bridge (D100): unregister BEFORE router.stop(), so app-unmounted
		// is the LAST event the extension sees — the chain's teardown is implied by
		// it, not replayed as a burst of view-destroyed events for a dead app. The
		// bridge's own guard drops this call when this instance never registered.
		// Separate gate from the publish above: that one also tests __PUZZLE_APP__
		// identity, which a re-mount elsewhere may have moved off this instance.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devtoolsAppUnmounted(this);
		this.router?.stop();
		// Morph teardown (v1.23, D55): if enableMorph wired a handler, drop its
		// document click listener and release any pinned/in-flight morph state so an
		// unmounted app leaks neither. The handler object carries `dispose` (morph.js);
		// stubs and the null-unregister case have none, hence the optional call.
		this.#morphHandler?.dispose?.();
		// Land any batched storage write before dropping the store (persistence is
		// deferred into Store.flush() — a mutation just before unmount would
		// otherwise only reach storage when the armed timer fires, and never at all
		// if the page unloads first). After router.stop() so mutations from
		// destroyed() hooks are captured too; flush() is a safe no-op when clean.
		this.#store?.flush();
		if (typeof window !== 'undefined' && this.#pageHideFlush) {
			window.removeEventListener('pagehide', this.#pageHideFlush);
			this.#pageHideFlush = null;
		}
		if (this._container) this._container.replaceChildren();

		this.ctx = null;
		this.#store = null; // getter throws again post-unmount (store torn down)
		this.router = null;
		this.formatters = null;
		this._container = null;
		this._mounted = false;
	}

	/** Resolve a CSS selector or Element to the mount node; throw if it's missing. */
	#resolveTarget(target) {
		if (target && typeof target === 'object' && target.nodeType === 1) {
			return target; // already an Element
		}
		if (typeof target === 'string') {
			const el = document.querySelector(target);
			if (!el) {
				throw new Error(`[puzzle] mount target not found: no element matches '${target}'`);
			}
			return el;
		}
		throw new Error(
			'[puzzle] mount target must be a CSS selector string or a DOM Element (config.target)'
		);
	}
}

export default PuzzleApp;
