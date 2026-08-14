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

import { installAdapterCapability } from '../capabilities.js';
import { Store } from '../datastore/store.js';
import { makeFormatterRegistry } from '../formatters.js';
import { mount } from '../views/viewManager.js';
import { setPortalHost } from '../views/portal.js';
import { assembleChain, makeRouteSnapshot, makeRouterStub } from '../ssg/assemble.js';
import { preloadTakeoverComponents } from '../ssg/preload.js';

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
 * @param {object} [options.adapter] opaque adapter capability
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
	adapter,
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
	// Portal outlet host (D144): the same lazy outlet the SPA runtime creates, as a
	// sibling of the static page's mount target.
	if (typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
		setPortalHost(targetEl.parentNode ?? document.body);

	const chain = route.chain.map((def, i) => ({ ...def, view: views[i] }));
	const entry = { fullPath: route.path, chain, layout };
	const routeSnapshot = makeRouteSnapshot(entry);
	const ctx = buildStaticContext({
		models,
		formatters,
		apiURL,
		storage,
		adapter,
		routerBase,
		route: routeSnapshot,
	});

	// Rehydrate the store from the inline data island (the same wire shape the HMR
	// snapshot uses). Absent, empty, or corrupt island → continue with the store's
	// configured persistence state (or a cold store). Silent only on absence/empty.
	hydrateStore(ctx.store);

	const { topVnode, instances } = await assembleChain(entry, ctx, routeSnapshot);

	// A marked static page is replacing content-complete prerendered DOM. Prepare
	// every nested non-routed component before that swap, and suppress its enter
	// too — mountComponent auto-chains playIn() onto each one, and that content is
	// already on screen. An unmarked prerender:false page keeps ordinary
	// fire-and-forget component mounting AND its ordinary nested enters.
	const isTakeover = targetEl.hasAttribute('data-puzzle-static');
	if (isTakeover) {
		const nested = await preloadTakeoverComponents(topVnode, ctx);
		for (const instance of nested) instance.skipEnter();
	}

	// Initial paint must NOT animate — the content is already on screen (same posture
	// as the SSG takeover: skipEnter every preloaded instance).
	for (const instance of instances) instance.skipEnter();

	// An unmarked prerender:false page has no fallback DOM to preserve and keeps the
	// original mount path byte-for-byte.
	if (!isTakeover) {
		targetEl.replaceChildren();
		mount(topVnode, targetEl, null, ctx);
		return;
	}

	// Mount in the real, connected container: mounted() hooks may focus or measure,
	// and the lifecycle contract says they see connected DOM. Keep the exact
	// prerendered nodes so a render()/mounted() rejection can restore visible
	// content instead of stranding a blank page.
	const prerendered = [...targetEl.childNodes];
	targetEl.replaceChildren();
	const root = topVnode.instance;
	topVnode.component = root;
	try {
		await root.mount(targetEl, {
			props: topVnode.props,
			children: topVnode.children,
			preloaded: true,
		});
		topVnode.el = root.element;
	} catch (err) {
		root.destroy();
		targetEl.replaceChildren(...prerendered);
		console.error(
			'[puzzle] component mount failed — the component was destroyed and the prerendered content restored (static pages have no later patch/remount):',
			err
		);
		return;
	}
	// Kept OUTSIDE the mount try: a rejected playIn() must never tear down a
	// component that mounted successfully (mountComponent's two-arg then() rule).
	// After the skipEnter above this is a no-op today; the guard is for whatever
	// changes that.
	await Promise.resolve(root.playIn()).catch((err) =>
		console.error('[puzzle] child enter animation failed:', err)
	);
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
	adapter,
	routerBase,
	route,
}) {
	installAdapterCapability(adapter, 'config.adapter');
	const storeOptions = { apiURL, adapter };
	if (storage !== undefined) storeOptions.storage = storage;
	const store = new Store(models, storeOptions);

	// The stub encodes HISTORY-style, and the prerenderer's stub does the same
	// (ssg/index.js buildContext) so the hrefs this re-render produces are
	// byte-identical to the prerendered ones. Static pages ship no router and no
	// click interception: they navigate by plain `<a>` page loads against
	// path-shaped files on disk (/about → about/index.html), so a hash-shaped href
	// would simply be dead — the app's `routerMode` is not carried into the page at
	// all (D159), and the build warns when one is configured. `routerBase` still
	// applies — a subpath deploy wants the prefix.
	const router = makeRouterStub(route, { base: routerBase });
	const registry = makeFormatterRegistry(formatters, (path) => router.url(path));

	return { store, router, formatters: registry };
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
