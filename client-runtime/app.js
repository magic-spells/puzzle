/**
 * PuzzleApp — the application class (constellation/doc/DOC-SPEC.md §1–§2, constellation/doc/DOC-APP-ANATOMY.md §3).
 *
 * Instantiate once with the v1 config surface and call `mount()`. The config
 * surface is frozen (SPEC §2): { target, routes, models, formatters, apiURL,
 * storage }, amended by v1.5 with { scrollBehavior } (D33), v1.6 with
 * { routerMode } (D34), v1.11 with { routerInitialPath } (memory mode only,
 * D42), v1.19 with { routerBase } (sub-path deploys, D51), v1.24 with
 * { transitionMode } (overlapping route transitions, D56), and v1.31 with
 * { beforeMount, mounted, beforeUnmount } (app lifecycle hooks, D66).
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
import { FormatterRegistry } from './formatters.js';
import { Router } from './router/router.js';
import builtinFormatters from '@magic-spells/puzzle/formatters/manifest';
import { snapshotToStorage, restoreStoreFromStorage, restoreViewsFromStorage } from './devstate.js';

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

	/**
	 * @param {object} config the frozen v1 surface (SPEC §2)
	 * @param {string|Element} config.target CSS selector or Element to mount into
	 * @param {Array} [config.routes] route definitions
	 * @param {object} [config.models] type name → model class registry
	 * @param {object} [config.formatters] app-level template formatters (override built-ins)
	 * @param {string} [config.apiURL] base URL for the D21 server read path
	 * @param {object} [config.storage] Storage-like object for persistence (opt-in)
	 * @param {false|Function} [config.scrollBehavior] router scroll handling
	 *   (v1.5, D33): omit for the default (top on push, restore on back/forward);
	 *   `false` to leave scroll alone; `(to, from, savedPosition) => {x,y}|null`
	 *   to customize per navigation
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
			scrollBehavior,
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
		//    the Store's own default (no persistence) stands otherwise.
		const storeOptions = { apiURL };
		if (storage !== undefined) storeOptions.storage = storage;
		this.#store = new Store(models, storeOptions);

		// 3. Formatters: built-ins first, then config formatters registered over
		//    them — register() overwrites by name, so a user formatter of the same
		//    name as a built-in wins.
		this.formatters = new FormatterRegistry(builtinFormatters);
		for (const [name, fn] of Object.entries(formatters)) {
			this.formatters.register(name, fn);
		}

		// 4. Router + the shared context object injected into every view. Pass
		//    `mode` through only when routerMode is set, so the Router's own default
		//    ('history') stands otherwise — mirroring how `storage` is conditionally
		//    passed to the Store above (D34).
		const routerOptions = { scrollBehavior };
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
		if (this.#morphHandler) this.router.setMorphHandler(this.#morphHandler);

		// 4a. Built-in `link` formatter (v1.46, D79): the router-bound render-time
		//     encoder — a path-shaped route in, a mode-correct href out via
		//     router.url(). Registered ONLY if absent, so a user `link` in
		//     config.formatters (step 3) wins — the if-absent posture of the
		//     requiredBuiltins seed (formatters.js). The arrow reads `this.router`
		//     lazily off the app, not a captured router, so unmount/re-mount never
		//     strands a stale router in the closure. Fail-soft (never throws in
		//     render): nullish → '' (builtin convention), else String()-coerced.
		if (!this.formatters.getAll().link) {
			this.formatters.register('link', (v) => {
				if (v == null) return '';
				const s = String(v);
				return this.router ? this.router.url(s) : s;
			});
		}
		this.ctx = { store: this.#store, router: this.router, formatters: this.formatters };

		// Claim mounted BEFORE the async start(): the initial navigation may await a
		// slow data(), and an unmount() during that window must actually tear down.
		// unmount() guards on this flag — were it still false here, the guard would
		// no-op and the pending navigation would later mount into a detached
		// container. Set after the target resolved + services wired, so a
		// target-resolution throw above still leaves the app un-mounted.
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
		}

		// App lifecycle: beforeMount (v1.31, SPEC §34, D66). The three ctx services
		// are live and the mounted flag is claimed, but navigation #0 has NOT run —
		// so a store seed here lands before the first data(). AWAITED: an async hook
		// finishes before router.start(). A throw/rejection ABORTS the mount — tear
		// back down to the unmounted state and rethrow (mount() rejects; re-mounting
		// later is legal). This abort path must NOT fire beforeUnmount (which pairs
		// only with a completed mount), so it calls #teardown() directly. The
		// _mounted guard: an unmount() during the in-flight hook already tore down
		// (and flipped the flag), so don't double-teardown — but swallow nothing.
		if (beforeMount != null) {
			try {
				await beforeMount.call(this, this);
			} catch (err) {
				if (this._mounted) this.#teardown();
				throw err;
			}
		}

		// unmount() may have run during an async beforeMount (SPEC §34): its
		// #teardown() flipped _mounted false and dropped our services. Stay torn
		// down — the router must never start (the same guard the post-start path
		// below already has for an unmount during router.start()).
		if (!this._mounted) return this;

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

		// unmount() may have run while start()'s initial navigation awaited data():
		// its router.stop() invalidated the nav (it abandoned without mounting) and
		// dropped our services. Stay torn down — do not re-wire anything.
		if (!this._mounted) return this;

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
		// Dev HMR (constellation/doc/DOC-SPEC.md §27, D57): retract the published app so a
		// stale reference can't outlive this instance — but only if it still points
		// at us (a re-mount elsewhere may have replaced it).
		if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && typeof window !== 'undefined' && window.__PUZZLE_APP__ === this) {
			window.__PUZZLE_APP__ = null;
		}
		this.router?.stop();
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
