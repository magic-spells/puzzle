/**
 * Static output kernel (D79) — `@magic-spells/puzzle/static`.
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
import { FormatterRegistry } from '../formatters.js';
import builtinFormatters from '@magic-spells/puzzle/formatters/manifest';
import { mount } from '../views/viewManager.js';
import { assembleChain } from '../ssg/assemble.js';

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
} = {}) {
	const targetEl = document.querySelector(target);
	if (!targetEl) {
		throw new Error(
			`[puzzle] static mount target not found — no element matches ${JSON.stringify(target)}`
		);
	}

	const ctx = buildStaticContext({ models, formatters, apiURL });

	// Rehydrate the store from the inline data island (the same wire shape the HMR
	// snapshot uses). Absent or empty island → a cold store (a page whose data() hits
	// no records, or a prerender:false page that seeded nothing). Silent on absence.
	hydrateStore(ctx.store);

	// Rebuild the chain defs by zipping each view class back onto its serialized route
	// def, then hand the assembled entry to the SHARED assembleChain — the exact
	// assembly the prerenderer ran, so the client tree matches the prerendered markup.
	const chain = route.chain.map((def, i) => ({ ...def, view: views[i] }));
	const entry = { fullPath: route.path, chain, layout };

	const { topVnode, instances } = await assembleChain(entry, ctx);

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
function buildStaticContext({ models = {}, formatters = {}, apiURL }) {
	const store = new Store(models, { apiURL });

	const registry = new FormatterRegistry(builtinFormatters);
	for (const [name, fn] of Object.entries(formatters)) {
		registry.register(name, fn);
	}

	return { store, router: makeRouterStub(), formatters: registry };
}

/** A router-shaped stub whose every navigation method throws (CONTRACT 4). */
function makeRouterStub() {
	const stub = {};
	const throwNoRouter = () => {
		throw new Error('[puzzle] static output has no router — use plain links');
	};
	for (const method of ROUTER_METHODS) stub[method] = throwNoRouter;
	return stub;
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
	const blob = JSON.parse(raw);
	store._hydrateAll(blob, { replace: true });
}

export default mountStatic;
