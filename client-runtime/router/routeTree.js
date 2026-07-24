/**
 * routeTree — the single source of the nested-routes → per-leaf flatten.
 *
 * Both the Router (router.js, which compiles each leaf into a matcher Entry) and
 * the SSG prerenderer (ssg/index.js, which enumerates the pages to emit) must
 * walk the `children` tree by the SAME rules — the same leaf set, the same
 * composed paths — or a route the app can navigate to would fail to prerender
 * (or a prerendered page would never match). This module owns those rules so
 * they live in exactly one place; each consumer keeps its OWN concerns (the
 * Router validates the chain + compiles a per-leaf regex; the SSG pass extracts
 * the inherited layout) inside the one `makeLeaf` callback it passes in.
 *
 * It is DOM-free and imports nothing, so it runs unchanged in the browser bundle
 * (via router.js) and under Node (the prerender pass) — the same dual-context
 * discipline ssg/assemble.js follows.
 */

/**
 * Join a parent path pattern with a RELATIVE child path. An index child (`''`)
 * composes to exactly the parent path; otherwise a single '/' joins them with the
 * parent's trailing slash trimmed: '/' + 'a' → '/a', '/settings' + 'x' →
 * '/settings/x'.
 */
export function joinPath(parentPath, childPath) {
	if (childPath === '') return parentPath;
	return parentPath.replace(/\/$/, '') + '/' + childPath;
}

/**
 * Depth-first walk of ONE route node in declaration order. For every LEAF (a
 * node with no children) it appends `makeLeaf(chain, fullPaths)` to `out`, where
 * `chain` is the root→leaf definition list and `fullPaths[i]` is the accumulated
 * path PATTERN at level i (so `fullPaths[fullPaths.length - 1]` is the leaf's full
 * path). A node WITH children is not a leaf — each child recurses under the joined
 * path (an index child `path: ''` re-composes the parent's exact path). The walk
 * neither validates nor compiles anything itself: `makeLeaf` is passed BY
 * REFERENCE (so the walk never allocates a closure), and each caller keeps its
 * own leaf shape — and, Router-side, its per-node validation over the returned
 * chain — inside that one callback.
 */
export function walkRouteTree(node, out, makeLeaf, ancestors = [], fullPaths = []) {
	const isRoot = ancestors.length === 0;
	const parentPath = isRoot ? null : fullPaths[fullPaths.length - 1];
	const fullPath = isRoot ? node.path : joinPath(parentPath, node.path);
	const chain = [...ancestors, node];
	const paths = [...fullPaths, fullPath];
	if (node.children && node.children.length) {
		for (const child of node.children) walkRouteTree(child, out, makeLeaf, chain, paths);
	} else {
		out.push(makeLeaf(chain, paths));
	}
}
