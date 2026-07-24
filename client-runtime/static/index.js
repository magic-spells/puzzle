/**
 * Static output kernel (D81) — `@magic-spells/puzzle/static`.
 *
 * The browser half of the true-static output mode. A page built with
 * `output: 'static'` ships content-complete HTML (SEO, no-JS readable) plus a small
 * per-page ES module that imports THIS kernel and its own view/layout/component
 * classes. `mountStatic()` upgrades the prerendered page to an interactive document:
 * it wires the same build-time ctx the prerenderer wired (Store + FormatterRegistry),
 * rehydrates the inline data island into the store, assembles + preloads the route
 * chain the SAME way the prerenderer did (shared assembleChain), and mounts the tree
 * over the prerendered markup. Because the tree re-renders identically from the same
 * data, the swap is flash-free (the replace-on-commit argument, D67 takeover).
 *
 * There is NO router in this module graph: static pages navigate by plain `<a>` page
 * loads, so `ctx.router` is a stub whose methods throw. There is also NO SPA takeover
 * and NO history API — a static page is an interactive document, not an SPA.
 *
 * `beforeMount` is NOT called here: it is build-time only in static mode (the
 * Astro-frontmatter policy — its store seed already ran at build time and rode into
 * the data island). Only component interactivity (event handlers, local setData
 * state, store mutations) runs client-side.
 *
 * This module runs in the browser only (it touches `document`). It is bundled per
 * page by the Go static build (compiler/internal/build), one entry per written page.
 */

import { Store } from '../datastore/store.js';
import { makeFormatterRegistry } from '../formatters.js';
import { mount } from '../views/viewManager.js';
import { assembleChain, makeRouteSnapshot } from '../ssg/assemble.js';

// The router methods a static page might reach for. Each throws — a static page has
// no history/router, so any programmatic navigation is a coding error the message
// points at plain links (CONTRACT 4). Kept in sync with the Router's public surface.
const ROUTER_METHODS = ['push', 'replace', 'back', 'forward', 'go', 'start', 'stop'];

/**
 * Mount a prerendered static page's interactive layer.
 *
 * @param {object} options
 * @param {string} options.target the `'#id'` selector for the mount element (the
 *   same `config.target` the shell surgery keyed on)
 * @param {Function[]} options.views the route chain's view classes, root → leaf,
 *   matching `route.chain` order
 * @param {Function|null} [options.layout] the top-level layout class, or null
 * @param {object} options.route the serialized route snapshot from the summary
 *   (`{ path, params, chain: [{ path, name?, meta? }] }`)
 * @param {object} [options.models] the app models map
 * @param {object} [options.formatters] the app custom formatters map
 * @param {string} [options.apiURL] the store's base API URL
 * @param {object} [options.storage] Storage-like persistence object
 * @param {'history'|'hash'|'memory'} [options.routerMode] URL carrier used by
 *   `ctx.router.url()` (history by default)
 * @param {string} [options.routerBase] normalized route URL prefix
 * @returns {Promise<void>}
 */
export async function mountStatic({
	target,
	views,
	layout = null,
	route,
	models,
	formatters,
	apiURL,
	storage,
	routerMode,
	routerBase,
} = {}) {
	const targetEl = document.querySelector(target);
	if (!targetEl) {
		throw new Error(
			`[puzzle] static mount target not found — no element matches ${JSON.stringify(target)}`
		);
	}

	// Rebuild the chain defs by zipping each view class back onto its serialized route
	// def, then hand the assembled entry to the SHARED assembleChain — the exact
	// assembly the prerenderer ran, so the client tree matches the prerendered markup.
	const chain = route.chain.map((def, i) => ({ ...def, view: views[i] }));
	const entry = { fullPath: route.path, chain, layout };
	const routeSnapshot = makeRouteSnapshot(entry);
	const ctx = buildStaticContext({
		models,
		formatters,
		apiURL,
		storage,
		routerMode,
		routerBase,
		route: routeSnapshot,
	});

	// Rehydrate the store from the inline data island (the same wire shape the HMR
	// snapshot uses). Absent, empty, or corrupt island → continue with the store's
	// configured persistence state (or a cold store). Silent only on absence/empty.
	hydrateStore(ctx.store);

	const { topVnode, instances } = await assembleChain(entry, ctx, routeSnapshot);

	// Initial paint must NOT animate — the content is already on screen (same posture
	// as the SSG takeover: skipEnter every preloaded instance).
	for (const instance of instances) instance.skipEnter();

	// Clear the prerendered children, then mount the freshly-assembled tree. The markup
	// re-renders identically from the same data, so the swap is flash-free. A
	// prerender:false page's target is already empty; the same path handles it.
	targetEl.replaceChildren();
	mount(topVnode, targetEl, null, ctx);
}

/**
 * Wire the build-time ctx exactly as ssg/index.js buildContext does — a Store over
 * the models + apiURL and a FormatterRegistry seeded with the built-ins then the
 * config formatters — EXCEPT `ctx.router` is a throwing stub (no Router import in
 * this module graph). `beforeMount` is NOT run (build-time only in static mode).
 */
function buildStaticContext({
	models = {},
	formatters = {},
	apiURL,
	storage,
	routerMode,
	routerBase,
	route,
}) {
	const storeOptions = { apiURL };
	if (storage !== undefined) storeOptions.storage = storage;
	const store = new Store(models, storeOptions);

	const router = makeRouterStub(route, { mode: routerMode, base: routerBase });
	const registry = makeFormatterRegistry(formatters, (path) => router.url(path));

	return { store, router, formatters: registry };
}

/**
 * Router-shaped static stub: navigation throws, url() keeps Router.url's exact
 * validation/pass-through/prefix semantics, and current is the page snapshot.
 */
function makeRouterStub(route, { mode = 'history', base = '' } = {}) {
	if (mode !== 'history' && mode !== 'hash' && mode !== 'memory') {
		throw new Error(
			`[puzzle] unknown router mode: "${mode}" (expected 'history', 'hash', or 'memory')`
		);
	}
	const normalizedBase = normalizeBase(base);
	const stub = {};
	const throwNoRouter = () => {
		throw new Error('[puzzle] static output has no router — use plain links');
	};
	for (const method of ROUTER_METHODS) stub[method] = throwNoRouter;
	stub.url = (path) => {
		if (typeof path !== 'string') {
			throw new Error(`[puzzle] router.url(path) expects a string path (got ${typeof path})`);
		}
		if (path[0] !== '/') return path;
		if (mode === 'memory') return path;
		if (mode === 'hash') return '#' + normalizedBase + path;
		return normalizedBase + path;
	};
	Object.defineProperty(stub, 'current', {
		enumerable: true,
		get: () => route,
	});
	return stub;
}

/** Keep Router's D51 base normalization/validation semantics without importing it. */
function normalizeBase(base) {
	if (!base) return '';
	if (base.includes('#') || base.includes('?')) {
		throw new Error(`[puzzle] router base must not contain "#" or "?": "${base}"`);
	}
	let normalized = base[0] === '/' ? base : '/' + base;
	normalized = normalized.replace(/\/+$/, '');
	return normalized;
}

/**
 * Read the inline JSON data island the shell surgery injected and hydrate the store
 * in REPLACE mode (`_hydrateAll`, shape-validated). Absent or empty → no-op (skip
 * silently): a page that seeded nothing simply mounts against a cold store.
 */
function hydrateStore(store) {
	const el = document.querySelector('script[data-puzzle-static-data]');
	if (!el) return;
	const raw = el.textContent;
	if (!raw || !raw.trim()) return;
	try {
		const blob = JSON.parse(raw);
		store._hydrateAll(blob, { replace: true });
	} catch (err) {
		console.error(
			'[puzzle] static data island is corrupt — mounting with the available store state',
			err
		);
	}
}

export default mountStatic;
