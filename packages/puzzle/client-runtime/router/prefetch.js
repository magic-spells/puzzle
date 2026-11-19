/**
 * Link prefetch (D195) — load a lazy route's code before the click.
 *
 * A link to an in-app route whose view or layout is a `lazy()` marker (D163)
 * starts that route's chunk download when the user shows intent: the pointer
 * rests on the link, a touch lands on it, or keyboard focus reaches it. A link
 * marked `data-prefetch="visible"` also starts when it scrolls into view. By
 * the time the click lands the chunk is usually in memory, so the navigation
 * runs as a warm lazy route — synchronously, exactly like an eager one.
 *
 * Only code is prefetched. No guard runs, no view is constructed and no
 * `data()` runs: prefetch calls the same memoized resolver navigation uses, so
 * a prefetched chunk is fetched once and a click mid-download joins it.
 *
 * Per link, `data-prefetch` overrides the app-wide `prefetch` config:
 * - absent → the app default (on unless `prefetch: false`); a route behind a
 *   guard is skipped, so gated code still never downloads on its own (D163).
 * - `""` / `"intent"` → prefetch on intent, guarded route or not.
 * - `"visible"` → also prefetch when the link scrolls into view.
 * - `"off"` → never prefetch this link.
 *
 * This module is reached only through the router's `__PUZZLE_HAS_LAZY__`
 * probe: an app that never calls `lazy()` has nothing to prefetch, so the
 * whole module folds out of its bundle.
 */

import { observeVisible } from '../views/visibility.js';

// a mouse or pen resting this long on a link counts as intent. short enough
// to finish well before a deliberate click, long enough that sweeping the
// pointer across a nav bar does not fetch every chunk it crosses.
const HOVER_DELAY = 60;

// the attribute that marks a link for scroll-into-view prefetch. matched
// exactly (lowercase), like the router's own `target` handling.
const VISIBLE_SELECTOR = 'a[data-prefetch="visible"]';

// per router: the app-wide default for links without `data-prefetch`, and the
// teardown while its listeners are live. a WeakMap rather than router fields,
// so a build without lazy() — where this module folds out — carries neither.
/** @type {WeakMap<object, { auto: boolean, stop?: () => void }>} */
const routers = new WeakMap();

/**
 * Record a router's `prefetch` option (config `prefetch`, D195).
 *
 * @param {object} router
 * @param {unknown} value `true` (also when omitted) or `false`
 */
export function setPrefetchDefault(router, value = true) {
	// a boolean only: a string like 'hover' reads as a mode the router does not
	// have, and treating it as true would hide the typo.
	if (typeof value !== 'boolean') {
		throw new Error(`[puzzle] prefetch must be a boolean (got ${typeof value})`);
	}
	routers.set(router, { auto: value });
}

/**
 * Tear down a router's link listeners; a no-op when none were added.
 * @param {object} router
 */
export function unwatchLinks(router) {
	// stop() is idempotent (abort, disconnect and clear all are), so a second
	// router.stop() needs no bookkeeping here.
	routers.get(router)?.stop?.();
}

/**
 * How one link prefetches: `'auto'` (the app default — skips guarded routes),
 * `'intent'` / `'visible'` (asked for by name — guarded routes too), or null
 * (never).
 *
 * @param {Element} a the link
 * @param {boolean} auto the app-wide `prefetch` config
 * @returns {'auto' | 'intent' | 'visible' | null}
 */
function linkMode(a, auto) {
	const value = a.getAttribute('data-prefetch');
	// no attribute: the app default decides.
	if (value == null) return auto ? 'auto' : null;
	if (value === 'off') return null;
	if (value === 'visible') return 'visible';
	// a bare `data-prefetch` and the spelled-out value are the same request.
	// anything else is a typo; it still prefetches on intent, and development
	// says which spellings exist.
	if (
		value !== '' &&
		value !== 'intent' &&
		(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
	) {
		console.warn(
			`[puzzle] data-prefetch="${value}" is not a prefetch mode — use "intent", "visible" or "off"`
		);
	}
	return 'intent';
}

/**
 * Whether the connection allows speculative downloads right now. A user who
 * asked the browser to save data, or who is on a 2g-class link, gets no
 * prefetch; the chunk still loads on click like any lazy route.
 */
function connectionAllows() {
	const connection = /** @type {{ saveData?: boolean, effectiveType?: string } | undefined} */ (
		/** @type {any} */ (navigator).connection
	);
	return !connection || (!connection.saveData && !/2g/.test(connection.effectiveType || ''));
}

/**
 * Wire document-level prefetch for one router, until unwatchLinks(router).
 *
 * The router hands in three answers so this module never reaches into it: how
 * an event names its link, which in-app path a link names, and how to load a
 * path's code.
 *
 * @param {object} router the owner, as given to setPrefetchDefault
 * @param {object} options
 * @param {(e: Event) => Element | null} options.anchor the link an event landed on
 * @param {(a: Element) => string | null} options.path the in-app path a link
 *   names, or null when a click on it would not be an in-app navigation
 * @param {(path: string, explicit: boolean) => unknown} options.load start
 *   loading a path's route code; `explicit` means the link asked by name, so a
 *   guarded route loads too
 */
export function watchLinks(router, { anchor, path, load }) {
	const state = routers.get(router) ?? { auto: true };
	routers.set(router, state);
	const auto = state.auto;
	// one abort tears down every listener at once (state.stop below).
	const controller = new AbortController();
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	// the link the pointer is over, so moving between a link's own children
	// (an icon inside the <a>) neither restarts nor cancels its timer.
	/** @type {Element | null} */
	let hovered = null;

	/**
	 * Prefetch one link if its mode and the connection allow it.
	 * @param {Element} a
	 */
	const go = (a) => {
		const mode = linkMode(a, auto);
		if (!mode || !connectionAllows()) return;
		// the path is read now, not when the pointer arrived, so a link whose
		// href changed in between prefetches where a click would go.
		const to = path(a);
		if (to != null) load(to, mode !== 'auto');
	};

	/**
	 * @param {string} type
	 * @param {(e: any) => void} listener
	 */
	const on = (type, listener) =>
		document.addEventListener(type, listener, { passive: true, signal: controller.signal });

	on('pointerover', (/** @type {PointerEvent} */ e) => {
		const a = anchor(e);
		if (a === hovered) return;
		clearTimeout(timer);
		hovered = a;
		if (!a) return;
		// a touch is a press already under way: the click follows in a few
		// hundred milliseconds, so start now. a mouse or pen waits to see that
		// the pointer stays.
		if (e.pointerType === 'touch') go(a);
		else timer = setTimeout(go, HOVER_DELAY, a);
	});

	on('pointerout', (/** @type {PointerEvent} */ e) => {
		// leaving for one of the link's own children is not leaving the link.
		const to = /** @type {Node | null} */ (e.relatedTarget);
		if (hovered && to && hovered.contains(to)) return;
		clearTimeout(timer);
		hovered = null;
	});

	on('focusin', (/** @type {FocusEvent} */ e) => {
		// keyboard focus is deliberate, so no delay.
		const a = anchor(e);
		if (a) go(a);
	});

	// ---- data-prefetch="visible" ---------------------------------------------
	// each marked link is observed once through the shared visibility registry
	// (the same one scroll-triggered enters use). links come and go with every
	// render, so a MutationObserver re-reads the document after each batch of
	// changes: new marked links join, and disconnected ones are let go so the
	// registry never pins a removed element. the map holds each link's disarm,
	// or null once it has been prefetched (never observed again).
	/** @type {Map<Element, (() => void) | null>} */
	const watched = new Map();

	const scan = () => {
		for (const [a, disarm] of watched) {
			if (!a.isConnected) {
				disarm?.();
				watched.delete(a);
			}
		}
		for (const a of document.querySelectorAll(VISIBLE_SELECTOR)) {
			if (watched.has(a)) continue;
			watched.set(
				a,
				observeVisible(a, '0px', () => {
					// once only: the chunk is memoized after its first load, so a
					// second trip into view would have nothing to do.
					watched.get(a)?.();
					watched.set(a, null);
					go(a);
				})
			);
		}
	};

	// without an IntersectionObserver there is no "visible", only intent.
	const mutations =
		typeof MutationObserver === 'function' && typeof IntersectionObserver === 'function'
			? new MutationObserver(scan)
			: null;
	if (mutations) {
		mutations.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['data-prefetch'],
		});
		scan();
	}

	state.stop = () => {
		clearTimeout(timer);
		controller.abort();
		mutations?.disconnect();
		for (const disarm of watched.values()) disarm?.();
		watched.clear();
	};
}
