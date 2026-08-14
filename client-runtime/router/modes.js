/**
 * Opt-in router modes (D159) — `@magic-spells/puzzle/router-modes`.
 *
 * History routing is the Router's inline, zero-config default and costs nothing
 * to import. Hash (D34) and memory (D42) routing are the deviations from it, and
 * they live HERE so an app that never imports this module never ships them: the
 * ~17 scattered mode branches the Router used to carry are now a handful of
 * `this.#mode?.…` seams whose bodies are in this file.
 *
 * ```js
 * import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
 *
 * new PuzzleApp({ routerMode: hashRouter() });
 * new PuzzleApp({ routerMode: memoryRouter({ initialPath: '/about' }) });
 * ```
 *
 * The factories are the public surface. What they return is an OPAQUE mode
 * descriptor — `create()` and the instance methods below are an internal
 * contract between this module and router.js, not API. `create()` exists so two
 * Routers built from one descriptor never share mutable state (memory mode's
 * entry stack): the Router calls it once, at construction.
 *
 * The mode instance carries only the deviations:
 * - `encode(path, base)` — the write-side URL encoder (history: `base + path`).
 * - `readPath(base)` — the read-side URL parser, `null` = "not a route"
 *   (history reads `location.pathname + location.search` inline).
 * - `clickFragment(fragment, e, base, router)` — a `'#…'` href was clicked.
 * - `clickLink(url, e, base, router)` — a same-origin absolute URL was clicked;
 *   returns true when the mode owns the decision and the interceptor must stop.
 * - `urlless` — the mode carries NO URL and takes NO document-level side effects
 *   (D42): no popstate listener, no scroll, no focus, no title/head. A urlless
 *   mode MUST also implement `start()`, `commit()`, `go()`, `clearPending()` and
 *   `reset()`, which own the entry bookkeeping `history` normally provides.
 */

import { normalizeRoutePath } from './routePath.js';

/**
 * Hash routing (v1.6, D34): the route rides in `location.hash` (`/#/user/123`)
 * instead of the pathname, for static hosts with no server-side rewrite. The
 * public API stays PATH-SHAPED — `push('/user/123')`, `current.path ===
 * '/user/123'` — so views and route definitions never mention the '#'. A
 * `routerBase` still applies and rides INSIDE the fragment (`#/myapp/docs`).
 *
 * The router listens on popstate only (never hashchange): fragment navigations
 * fire popstate in supported browsers, the same bet Vue Router 4 makes. A
 * popstate whose hash is a NON-route fragment (`#section2`, an in-page anchor)
 * is ignored — `readPath` returns null and the rendered view is left alone.
 */
export function hashRouter() {
	// `name` is diagnostics only (the SSG names the mode a hybrid build refuses);
	// nothing in the Router reads it.
	return { name: 'hash', create: () => hashMode };
}

// Stateless, so every hashRouter() descriptor hands out the same instance.
const hashMode = {
	/**
	 * Parse `location.hash` into a path-shaped, BASE-STRIPPED route (D34/D51):
	 * `''`/`'#'` → `'/'`; `'#/...'` → the fragment minus the '#' (keeping any
	 * `?query` that lives inside it); anything else (a bare `#anchor`) → `null`,
	 * meaning "not a route fragment" so the caller leaves the view alone.
	 *
	 * With a base the fragment must be exactly `'#' + base` (→ `'/'`), the base
	 * followed directly by a query (→ `'/?…'` — the app ROOT carrying that query,
	 * mirroring history mode's `pathname === base` branch), or under
	 * `'#' + base + '/'`; any OTHER fragment (including a `'#/...'` outside the
	 * base) → `null`. A bare `''`/`'#'` still → `'/'` (the host root maps to the
	 * app root).
	 */
	readPath(base) {
		const hash = location.hash;
		if (hash === '' || hash === '#') return '/';
		if (base) {
			if (hash === '#' + base) return '/';
			if (hash.startsWith('#' + base + '?')) return '/' + hash.slice(1 + base.length);
			if (hash.startsWith('#' + base + '/')) return hash.slice(1 + base.length);
			return null; // '#/...' outside the base is a non-route fragment (D51)
		}
		if (hash.startsWith('#/')) return hash.slice(1);
		return null;
	},

	/** Write-side inverse of readPath: the base rides inside the fragment. */
	encode(path, base) {
		return '#' + base + path;
	},

	/**
	 * A relative `'#…'` href: `'#/...'` IS a route here — intercept it; a bare
	 * `'#anchor'` is still an in-page anchor and falls through to the browser.
	 */
	clickFragment(fragment, e, base, router) {
		tryHashFragment(fragment, e, base, router);
	},

	/**
	 * A same-origin absolute URL: only a SAME-PAGE url carrying a route fragment
	 * is an in-app navigation. A differing pathname is a real navigation away
	 * from the app shell — never push its pathname. Either way the hash mode owns
	 * the decision, so the interceptor stops here (returns true).
	 */
	clickLink(url, e, base, router) {
		if (url.pathname === location.pathname) tryHashFragment(url.hash, e, base, router);
		return true;
	},
};

/**
 * Route a clicked fragment if it names an in-app path (D34/D51). With a base the
 * fragment must be exactly `'#' + base` (→ `'/'`), the base followed directly by
 * a query, or under `'#' + base + '/'`; base-less, any `'#/...'` is a route. A
 * bare `'#anchor'` matches nothing and is left to the browser. preventDefault is
 * called HERE, before push.
 */
function tryHashFragment(fragment, e, base, router) {
	if (base) {
		if (fragment === '#' + base) {
			e.preventDefault();
			router.push('/');
			return;
		}
		if (fragment.startsWith('#' + base + '?')) {
			e.preventDefault();
			router.push('/' + fragment.slice(1 + base.length));
			return;
		}
		if (fragment.startsWith('#' + base + '/')) {
			e.preventDefault();
			router.push(fragment.slice(1 + base.length));
		}
		return;
	}
	if (fragment.startsWith('#/')) {
		e.preventDefault();
		router.push(fragment.slice(1));
	}
}

/**
 * Memory routing (v1.11, D42): the route lives ENTIRELY in router state —
 * `location` and `history` are never read or written. For tests (no jsdom
 * history fakery) and embedded/iframe apps that must not touch the host page's
 * URL. An in-memory entry stack (`{ path }` entries + an index) replaces
 * `history`: push truncates any forward entries and appends (browser semantics),
 * and the initial navigation is seeded from `initialPath` (default `'/'` —
 * there is no URL to read).
 *
 * The FULL D19/D28/D30 pipeline runs unchanged (atomic commit, cancellation
 * tokens, sequential transitions, nested chains); only the URL side effects
 * vanish. Deliberate differences: NO document-level side effects — no popstate
 * listener, no title/head sync (an embed must not rename the host tab, D84), no
 * scroll and no focus management (stealing the host page's scroll or keyboard is
 * strictly worse than leaving them alone, D93). `routerBase` is inert (there is
 * no URL to prefix). The click interceptor STAYS ACTIVE: same-origin pathname
 * links route in memory exactly as in history mode, so a bare `#anchor` href
 * falls through to the browser.
 *
 * @param {{ initialPath?: string }} [options] the first route (default `'/'`)
 */
export function memoryRouter({ initialPath } = {}) {
	const seed = normalizeRoutePath(initialPath ?? '/');
	return { name: 'memory', create: () => makeMemoryMode(seed) };
}

function makeMemoryMode(seed) {
	// The entry stack + current index; both move ONLY at commit (D19), so a
	// superseded navigation leaves them exactly as they were. `pending` is the
	// TARGET index of the most recent in-flight go()/back()/forward(): without it
	// two SYNCHRONOUS back() calls would both read `index` and collapse into one
	// move. Null until start() (and again after reset()), which is why go() and
	// commit() degrade silently before the router is started.
	let stack = null;
	let index = -1;
	let pending = null;

	return {
		urlless: true,

		/** No URL carrier, so a path is its own href (D79). */
		encode(path) {
			return path;
		},

		/** Seed the stack and hand the router navigation #0's path. */
		start() {
			stack = [{ path: seed }];
			index = 0;
			pending = null;
			return seed;
		},

		/** Router teardown: drop the stack so a restart re-seeds from scratch. */
		reset() {
			stack = null;
			index = -1;
			pending = null;
		},

		/**
		 * A push/replace supersedes any in-flight pop (it truncates forward entries
		 * or rewrites the current one), and so does a navigation that terminates
		 * without committing — drop the pop target so the next go() bases off the
		 * committed index.
		 */
		clearPending() {
			pending = null;
		},

		/**
		 * Move `n` entries. Returns the target `{ path, index }` for the router to
		 * navigate to as a POP, or null for a no-op: out of range, before start(),
		 * or `n` that lands on the entry already targeted (go(0), or a forward that
		 * exactly undoes a pending back — a browser would RELOAD on go(0), which
		 * memory mode has no notion of).
		 */
		go(n) {
			if (!stack) return null;
			const base = pending ?? index;
			const target = base + n;
			if (target < 0 || target >= stack.length || target === base) return null;
			pending = target;
			return { path: stack[target].path, index: target };
		},

		/**
		 * The commit point (D19/D61) — a failed or superseded navigation never
		 * reaches here, so the stack tracks committed navigations only. Push
		 * truncates forward entries and appends; replace overwrites the current
		 * entry IN PLACE (no truncate, no append, no index move); a pop advances the
		 * index to the target go() computed.
		 */
		commit(path, push, replace, popIndex) {
			if (push) {
				stack.length = index + 1;
				stack.push({ path });
				index = stack.length - 1;
			} else if (replace) {
				stack[index] = { path };
			} else if (popIndex != null) {
				index = popIndex;
			}
			pending = null;
		},
	};
}
