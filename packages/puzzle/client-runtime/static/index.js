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

import { hydrateReadState, installAdapterCapability } from '../capabilities.js';
import { Store } from '../datastore/store.js';
import { makeFormatterRegistry } from '../formatters.js';
import { mount } from '../views/viewManager.js';
import { setPortalHost } from '../views/portal.js';
import { assembleChain, localizeRouterStub, makeRouteSnapshot, makeRouterStub } from '../ssg/assemble.js';
import { preloadTakeoverComponents } from '../ssg/preload.js';
import {
	assignSameOrigin,
	createI18n,
	installTranslate,
	islandLocale,
	urlLocale,
} from '../i18n.js';
import { headText, resolveHeadField, syncTitle } from '../head.js';
import { normalizeBase } from '../router/router.js';
import manifestData from '@magic-spells/puzzle/i18n/manifest';

/** @import { PuzzleView } from '../views/PuzzleView.js' */
/** @import { FormatterRegistry } from '../formatters.js' */
/** @import { AdapterCapability } from '../capabilities.js' */
/** @import { RouterStub } from '../ssg/assemble.js' */

/**
 * The static page's ctx: the build-time Store + FormatterRegistry, the throwing
 * router stub, and the translation service once one is installed (D175).
 * @typedef {{ store: Store, router: RouterStub, formatters: FormatterRegistry,
 *   i18n?: ReturnType<typeof createI18n> }} StaticContext
 */

/**
 * Mount a prerendered static page's interactive layer.
 *
 * @param {object} [options] (`target`, `views` and `route` are required)
 * @param {string} [options.target] the `'#id'` selector for the mount element (the
 *   same `config.target` the shell surgery keyed on)
 * @param {Function[]} [options.views] the route chain's view classes, root → leaf,
 *   matching `route.chain` order
 * @param {Function|null} [options.layout] the top-level layout class, or null
 * @param {{ path: string, params?: Record<string, string>,
 *   chain: Array<{ path: string, name?: string, meta?: object }> }} [options.route] the
 *   serialized route snapshot from the summary
 * @param {object} [options.models] the app models map
 * @param {object} [options.formatters] the app custom formatters map
 * @param {string} [options.apiURL] the store's base API URL
 * @param {Pick<Storage, 'getItem' | 'setItem'>} [options.storage] Storage-like persistence object
 * @param {import('../capabilities.js').AdapterCapability} [options.adapter] opaque adapter capability
 * @param {string} [options.routerBase] normalized route URL prefix
 * @param {{ manifest?: import('../i18n.js').I18nManifest, tables?: Record<string, import('../i18n.js').LocaleTable>,
 *   locale?: string, navigate?: (href: string) => void }} [options.__i18n] internal
 *   test seam, not API: translation service options (`{ manifest, tables, locale }`)
 *   so nothing is fetched, and a `navigate` that stands in for `location.assign`
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
	__i18n,
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
	// Records FIRST, then the read state (D161): hydrateReadState drops an absence
	// whose record turned out to be present, which only works in that order.
	hydrateStore(ctx.store);
	hydrateReadState(ctx.store, readIsland());

	// Translations (D175): the page's own island answers the build locale with no
	// request; a viewer whose locale differs fetches it here, BEFORE the mount, so
	// the prerendered default-language page swaps to theirs exactly once. A switch
	// re-assembles and re-mounts this page's chain (see remount below).
	/** @type {(() => Promise<void>) | null} */
	let remount = null;
	// A switch that lands before the remount is armed (a mounted() hook calling
	// setLocale) is replayed once armRemount runs, instead of being dropped.
	let earlyRefresh = false;
	if (typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__) {
		/** @type {NonNullable<Parameters<typeof createI18n>[0]>} */
		const i18nOptions = {
			// __i18n is an internal test seam ({ manifest, tables, locale }); a build
			// reads the manifest module.
			...__i18n,
			// Locale files sit on the BARE routerBase, never under a locale prefix:
			// they are emitted once and shared by every locale's pages (D177).
			url: (path) => normalizeBase(routerBase) + '/' + path,
			refresh: () => (remount ? remount() : void (earlyRefresh = true)),
			page: () => location.pathname + location.search + location.hash,
		};
		// Locale prefix routing (D177): the URL decides the locale — its prefix,
		// then the page's own table island — ahead of the stored choice and the
		// browser's languages; links encode under that locale's prefix; and
		// setLocale loads the same page under the other prefix instead of
		// re-rendering in place.
		if (typeof __PUZZLE_HAS_LOCALE_ROUTING__ === 'undefined' || __PUZZLE_HAS_LOCALE_ROUTING__) {
			const manifest = __i18n?.manifest ?? manifestData;
			if (manifest?.routing === 'prefix') {
				// An unprefixed page with no island is a default-locale page: the stored
				// choice and the browser never pick its locale, so text and links agree.
				const pageLocale =
					urlLocale(location.pathname, routerBase, manifest) ?? islandLocale() ?? manifest.defaultLocale;
				i18nOptions.locale = pageLocale;
				i18nOptions.routerBase = routerBase;
				// A seam-supplied navigate (tests) stands; a build loads the page.
				i18nOptions.navigate ??= assignSameOrigin;
				localizeRouterStub(ctx.router, {
					base: routerBase,
					locale: pageLocale,
					defaultLocale: manifest.defaultLocale,
					locales: Object.keys(manifest.locales),
				});
			}
		}
		const i18n = createI18n(i18nOptions);
		if (i18n) {
			ctx.i18n = i18n;
			installTranslate(ctx.formatters, i18n);
			await i18n.__ready();
			// The build wrote the page's <title> in its own locale (the island's tag);
			// a viewer in another one gets a translated `{ t }` title in theirs.
			if (i18n.locale !== (islandLocale() ?? i18n.defaultLocale)) syncLocaleTitle(chain, i18n);
		}
	}

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

	// A locale switch (D175) rebuilds this page the way the SPA router's
	// same-location rebuild does: preload a fresh chain — nested components too,
	// so nothing mounts late or animates in — against the new table, then swap it
	// in for the mounted one in one step. The old page is destroyed only once the
	// new one has mounted; a mount that throws is destroyed instead, the old DOM
	// goes back, and setLocale rejects (the SPA's failed-rebuild contract: the
	// old page stays, the new locale is already active). Last switch wins.
	/** @param {PuzzleView} root the mounted top-level instance */
	const armRemount = (root) => {
		if (!(typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__) || !ctx.i18n) return;
		let current = root;
		let token = 0;
		remount = async () => {
			const my = ++token;
			const next = await assembleChain(entry, ctx, routeSnapshot);
			const nested = await preloadTakeoverComponents(next.topVnode, ctx);
			if (my !== token) {
				for (const instance of next.instances) instance.destroy();
				for (const instance of nested) instance.destroy();
				return;
			}
			for (const instance of next.instances) instance.skipEnter();
			for (const instance of nested) instance.skipEnter();
			const previous = [...targetEl.childNodes];
			targetEl.replaceChildren();
			const top = next.topVnode;
			const root = top.instance;
			top.component = root;
			try {
				await root.mount(targetEl, { props: top.props, children: top.children, preloaded: true });
				top.el = root.element;
			} catch (err) {
				root.destroy();
				targetEl.replaceChildren(...previous);
				throw err;
			}
			current.destroy();
			current = root;
			syncLocaleTitle(chain, ctx.i18n);
		};
		if (earlyRefresh) {
			earlyRefresh = false;
			remount().catch((err) => console.error('[puzzle] locale switch could not rebuild the page:', err));
		}
	};

	// An unmarked prerender:false page has no fallback DOM to preserve and keeps the
	// original mount path byte-for-byte.
	if (!isTakeover) {
		targetEl.replaceChildren();
		mount(topVnode, targetEl, null, ctx);
		armRemount(topVnode.instance);
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
	armRemount(root);
	// Kept OUTSIDE the mount try: a rejected playIn() must never tear down a
	// component that mounted successfully (mountComponent's two-arg then() rule).
	// After the skipEnter above this is a no-op today; the guard is for whatever
	// changes that.
	await Promise.resolve(root.playIn()).catch((err) =>
		console.error('[puzzle] child enter animation failed:', err)
	);
}

/**
 * A translated route title (`meta.title: { t: 'key' }`, D177) follows the active
 * locale, as the SPA router's #syncHead does; a plain string title is the one the
 * build already wrote, so it is left alone. Only called behind the
 * `__PUZZLE_HAS_I18N__` probe.
 *
 * @param {ReadonlyArray<{ meta?: Record<string, any> | null }>} chain the page's route defs, root → leaf
 * @param {import('../head.js').HeadI18n} i18n
 */
function syncLocaleTitle(chain, i18n) {
	const title = resolveHeadField(chain, 'title');
	if (title && typeof title === 'object') syncTitle(headText(title, i18n));
}

/**
 * Wire the build-time ctx exactly as ssg/index.js buildContext does — a Store over
 * the models + apiURL and a FormatterRegistry seeded with the built-ins then the
 * config formatters — EXCEPT `ctx.router` is a throwing stub (no Router import in
 * this module graph). `beforeMount` is NOT run (build-time only in static mode).
 *
 * @param {{ models?: object, formatters?: object, apiURL?: string,
 *   storage?: Pick<Storage, 'getItem' | 'setItem'>, adapter?: AdapterCapability,
 *   routerBase?: string, route: object }} options
 * @returns {StaticContext}
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
	/** @type {{ apiURL?: string, adapter?: AdapterCapability, storage?: Pick<Storage, 'getItem' | 'setItem'> }} */
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
	const registry = makeFormatterRegistry(
		formatters,
		// Read router.url per call: locale prefix routing (D177) swaps in its
		// locale-aware url(path, options) after this registry is built.
		typeof __PUZZLE_HAS_LOCALE_ROUTING__ === 'undefined' || __PUZZLE_HAS_LOCALE_ROUTING__
			? (path, options) => router.url(path, options)
			: (path) => router.url(path)
	);

	return { store, router, formatters: registry };
}

/**
 * Read the inline JSON data island the shell surgery injected and hydrate the store
 * in REPLACE mode (`_hydrateAll`, shape-validated). Absent or empty → no-op (skip
 * silently): a page that seeded nothing simply mounts against a cold store.
 *
 * @param {Store} store
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

/**
 * The build's read-state envelope (D161): which collections the prerender settled
 * completely and which identities it settled as absent. Without it the browser
 * session would refetch every collection and re-404 every miss the build already
 * resolved. The island is only emitted when the page settled something, so absent
 * or corrupt → null, and the session simply faults as it would have.
 */
function readIsland() {
	const el = document.querySelector('script[data-puzzle-static-read]');
	if (!el) return null;
	const raw = el.textContent;
	if (!raw || !raw.trim()) return null;
	try {
		return JSON.parse(raw);
	} catch (err) {
		console.error('[puzzle] static read-state island is corrupt — ignoring it', err);
		return null;
	}
}

export default mountStatic;
