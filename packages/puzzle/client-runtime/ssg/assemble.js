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
 * It imports nothing DOM-shaped (ViewNode, plus the Router's pure URL helpers), so
 * it runs unchanged under Node (the prerender pass) and in the browser (the kernel).
 */

import { ViewNode } from '../views/ViewNode.js';
import { encodeURL, normalizeBase } from '../router/router.js';
import { normalizeRoutePath } from '../router/routePath.js';

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
 * @param {{views: Function[], layout: Function|null}} [resolved] classes already
 *   resolved from the entry's `lazy()` markers (D163). ONLY the Node prerender
 *   pass passes it — that is the one caller whose entries can hold markers, and
 *   keeping the resolver out of this module keeps `lazy()` out of every static
 *   page bundle (the static browser kernel zips real classes onto its route JSON,
 *   so a marker can never reach it).
 * @returns {Promise<{ topVnode: import('../views/ViewNode.js').ViewNode,
 *   route: object, instances: object[] }>} `topVnode` is the assembled tree (the
 *   layout vnode when a layout wraps the chain, else the root view vnode);
 *   `route` is the frozen snapshot threaded to every preload; `instances` are the
 *   preloaded view/layout instances (root→leaf, layout last) so the caller can
 *   e.g. skipEnter() each one.
 */
export async function assembleChain(entry, ctx, route = makeRouteSnapshot(entry), resolved = null) {
	const { chain } = entry;
	const viewClasses = resolved ? resolved.views : chain.map((node) => node.view);
	const LayoutClass = resolved ? resolved.layout : entry.layout;

	// Preload each chain level's view (root → leaf), then the layout.
	const instances = [];
	for (let i = 0; i < chain.length; i++) {
		const view = new viewClasses[i](ctx);
		await view.preload({ params: {}, props: {}, route });
		instances.push(view);
	}

	// Assemble the chain leaf-up into nested component vnodes, each adopting its
	// preloaded instance (mirrors router.js #navigate ~945-958).
	let childVnode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		const vnode = new ViewNode(viewClasses[i], {}, childVnode ? [childVnode] : []);
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
 *
 * The path runs through the Router's own normalizer: a live Router exposes
 * `/caf%C3%A9` for a route declared `/café`, so a raw snapshot would make
 * `this.route.path` differ between the prerender and the takeover/mount that
 * replaces it. Both prerender modes build the snapshot here, so normalizing
 * once keeps every side in the same spelling (the operation is idempotent).
 */
export function makeRouteSnapshot({ chain, fullPath }) {
	const path = normalizeRoutePath(fullPath);
	return Object.freeze({
		path,
		pathname: path,
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
 * client re-render. Navigation throws; `url()` IS Router.url's encoder (the shared
 * encodeURL), so the two can never drift; `current` is the page snapshot.
 *
 * Encoding is HISTORY-style, hard-coded (D159): a static page physically lives at
 * /about/index.html and ships no router or click interception, so a hash-shaped
 * href would be a dead link and a memory-shaped one would drop the base. Both
 * callers already forced 'history' before the mode became an object.
 *
 * @param {object} route the D83 route snapshot (makeRouteSnapshot output)
 * @param {{ base?: string }} [opts]
 * @returns {object} a `{ url, current, push, replace, … }` router facade
 */
export function makeRouterStub(route, { base = '' } = {}) {
	const normalizedBase = normalizeBase(base);
	const stub = {};
	const throwNoRouter = () => {
		throw new Error('[puzzle] static output has no router — use plain links');
	};
	for (const method of ROUTER_METHODS) stub[method] = throwNoRouter;
	stub.url = (path) => encodeURL(path, null, normalizedBase);
	Object.defineProperty(stub, 'current', {
		enumerable: true,
		get: () => route,
	});
	return stub;
}

export default assembleChain;
