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
 * @returns {Promise<{ topVnode: import('../views/ViewNode.js').ViewNode,
 *   route: object, instances: object[] }>} `topVnode` is the assembled tree (the
 *   layout vnode when a layout wraps the chain, else the root view vnode);
 *   `route` is the frozen snapshot threaded to every preload; `instances` are the
 *   preloaded view/layout instances (root→leaf, layout last) so the caller can
 *   e.g. skipEnter() each one.
 */
export async function assembleChain(entry, ctx) {
	const { chain, layout: LayoutClass, fullPath } = entry;
	const leaf = chain[chain.length - 1];

	// Per-navigation route snapshot (v1.15, D47): SAME four keys + semantics as the
	// Router builds at router.js:809 — `{ path, route, params, chain }`, frozen —
	// threaded to every routed view/layout preload() so `this.route` is populated
	// exactly as in the browser. Views read `this.route.route.name` /
	// `this.route.chain[0].name` / `this.route.route.meta`, so the top-level keys
	// are `route` (the matched LEAF def) and `chain` (root → leaf defs), NOT bare
	// name/meta. Static routes carry no params, so `params` is {}.
	const route = Object.freeze({
		path: fullPath,
		route: leaf,
		params: {},
		chain,
	});

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

export default assembleChain;
