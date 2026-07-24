/**
 * assemble — DOM-free layout+view chain assembly, shared by the prerenderer
 * (ssg/index.js) and the static browser kernel (static/index.js).
 *
 * Both the build-time serializer and the client-side kernel must build the exact
 * same nested ViewNode tree from a route chain, or a prerendered page and its
 * client rehydration would diverge. This module is the single source of that
 * assembly: it preloads each chain level's instance (created() + awaited data(),
 * no DOM — PuzzleView.preload), builds the nested keyed component vnodes the way
 * the Router's #navigate does (layout wrapping the view chain via slot children,
 * each `.instance` pinned), and freezes the per-navigation route snapshot.
 *
 * It imports nothing DOM-shaped (only ViewNode), so it runs unchanged under Node
 * (the prerender pass) and in the browser (the kernel).
 */

import { ViewNode } from '../views/ViewNode.js';

/**
 * Instantiate + preload the layout+view chain for one route and assemble it into
 * a nested component vnode tree.
 *
 * @param {object} entry an enumerated route entry — { fullPath, chain (root→leaf
 *   route defs, each with a `.view` class), layout (LayoutClass|null) }
 * @param {object} ctx the { store, router, formatters } passed to every preload
 * @param {object} [route] an already-built static route snapshot. The static
 *   browser kernel supplies this so `ctx.router.current` and `this.route` share
 *   the exact same object during preload.
 * @returns {Promise<{ topVnode: import('../views/ViewNode.js').ViewNode,
 *   route: object, instances: object[] }>} `topVnode` is the assembled tree (the
 *   layout vnode when a layout wraps the chain, else the root view vnode);
 *   `route` is the frozen snapshot threaded to every preload; `instances` are the
 *   preloaded view/layout instances (root→leaf, layout last) so the caller can
 *   e.g. skipEnter() each one.
 */
export async function assembleChain(entry, ctx, route = makeRouteSnapshot(entry)) {
	const { chain, layout: LayoutClass } = entry;

	// Preload each chain level's view (root → leaf), then the layout.
	const instances = [];
	for (const node of chain) {
		const view = new node.view(ctx);
		await view.preload({ params: {}, props: {}, route });
		instances.push(view);
	}

	// Assemble the chain leaf-up into nested component vnodes, each adopting its
	// preloaded instance (mirrors router.js #navigate ~945-958).
	let childVnode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		const vnode = new ViewNode(chain[i].view, {}, childVnode ? [childVnode] : []);
		vnode.instance = instances[i];
		childVnode = vnode;
	}
	let topVnode = childVnode;

	// A top-level layout wraps the whole chain, hosting it at its <Slot/>.
	if (LayoutClass) {
		const layout = new LayoutClass(ctx);
		await layout.preload({ params: {}, props: {}, route });
		const layoutVnode = new ViewNode(LayoutClass, {}, [topVnode]);
		layoutVnode.instance = layout;
		instances.push(layout);
		topVnode = layoutVnode;
	}

	return { topVnode, route, instances };
}

/**
 * Build the frozen D83 route snapshot shared by static prerender and mount.
 * Static paths carry no params/query/fragment, so their pathname is the full
 * path and the query object is a frozen null-prototype empty map.
 */
export function makeRouteSnapshot({ chain, fullPath }) {
	return Object.freeze({
		path: fullPath,
		pathname: fullPath,
		query: Object.freeze(Object.create(null)),
		hash: '',
		route: chain[chain.length - 1],
		params: {},
		chain,
	});
}

// The router methods a static page might reach for. Each throws — a static page has
// no history/router, so any programmatic navigation is a coding error the message
// points at plain links (CONTRACT 4). Kept in sync with the Router's public surface.
const ROUTER_METHODS = ['push', 'replace', 'back', 'forward', 'go', 'start', 'stop'];

/**
 * Router-shaped static stub, DOM-free and shared by BOTH the true-static browser
 * kernel (static/index.js) and the static-mode prerender ctx (ssg/index.js) so
 * `url()` and `current` are byte-identical between the prerendered HTML and the
 * client re-render. Navigation throws; `url()` keeps Router.url's exact
 * validation/pass-through/prefix semantics; `current` is the page snapshot.
 *
 * @param {object} route the D83 route snapshot (makeRouteSnapshot output)
 * @param {{ mode?: 'history'|'hash'|'memory', base?: string }} [opts]
 * @returns {object} a `{ url, current, push, replace, … }` router facade
 */
export function makeRouterStub(route, { mode = 'history', base = '' } = {}) {
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
export function normalizeBase(base) {
	if (!base) return '';
	if (base.includes('#') || base.includes('?')) {
		throw new Error(`[puzzle] router base must not contain "#" or "?": "${base}"`);
	}
	let normalized = base[0] === '/' ? base : '/' + base;
	normalized = normalized.replace(/\/+$/, '');
	return normalized;
}

export default assembleChain;
