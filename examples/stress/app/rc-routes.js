/**
 * The `route-churn` route subtree: five nested ancestor levels and 50 leaves.
 *
 * ── How a multi-route scenario coexists with a one-route app ───────────────
 *
 * Every other scenario in this lab rides on the QUERY STRING: there is exactly
 * one route (`/`), Home hosts the active scenario in `#scenario-stage`, and a
 * parameter change is a `router.replace()` that re-keys the stage component.
 * That design is deliberate and this scenario does not disturb it.
 *
 * But route-churn measures the ROUTER, so it cannot be a component in a stage —
 * it needs real route nodes in the real route table. Three options were on the
 * table; this file is the third:
 *
 *   1. A second PuzzleApp with a memory-mode router, mounted into the stage.
 *      REJECTED. `client-runtime/devtools.js` holds exactly ONE app slot
 *      (`boundApp`): a second app's mount rebinds the DevTools bridge to
 *      itself, and its unmount then tears the bridge down entirely — leaving a
 *      developer with the Performance panel open staring at a dead session for
 *      the app that is still mounted. `window.__PUZZLE_APP__` is clobbered the
 *      same way, and the first router's document-level click interceptor eats
 *      clicks inside the second app's DOM.
 *
 *   2. Nest the subtree UNDER `/` so Home stays mounted as chain level 0.
 *      REJECTED. Home would then be a reused ancestor on every navigation, and
 *      Home is a heavy view — control panel, stats grid, result log. Its render
 *      cost would swamp the structure being counted, and the measurement would
 *      end up describing Home rather than the router.
 *
 *   3. A SIBLING top-level subtree, which is what this is. `/rc/…` is its own
 *      chain with its own layout; selecting the scenario navigates out of `/`
 *      and Home unmounts. The scenario API is registered by RcLayout, which is
 *      mounted for the whole subtree, so `window.__STRESS__` keeps working
 *      unchanged. The cost is that the lab's control panel is not on screen
 *      while route-churn is active, so RcLayout carries its own minimal panel
 *      and a way back.
 *
 * `stress-controller.js` maps the scenario name to `RC_ENTRY_PATH` instead of
 * `/?scenario=…`; nothing else in the controller knows this scenario is
 * special.
 *
 * ── The shape, and why it is shaped that way ───────────────────────────────
 *
 *   /rc                          level 1
 *   /rc/s2                       level 2
 *   /rc/s2/s3                    level 3
 *   /rc/s2/s3/s4                 level 4
 *   /rc/s2/s3/s4/s5              level 5
 *   /rc/s2/s3/s4/s5/leaf-0…49    50 DISTINCT leaf route nodes
 *   /rc/s2/s3/s4/s5/p/:id        one PARAMETERISED leaf — the control arm
 *
 * The reuse prefix `keep` is computed by route-node OBJECT IDENTITY, not by
 * path text (`router.js` #navigate). That single fact is why there are two
 * kinds of leaf here, and they exercise two genuinely different code paths:
 *
 *   • leaf-0 → leaf-1 diverges at the last level, so `keep` (5) is LESS than
 *     the chain length (6). The router assembles the whole chain leaf-up and
 *     pushes it through the reused prefix via applyParentUpdate(), AFTER
 *     having already refreshed that same prefix pre-commit. This is the arm
 *     that can double-render.
 *
 *   • p/1 → p/2 is the SAME chain with different params, so
 *     `keep === chain.length` and the router takes its params-only branch,
 *     which has no applyParentUpdate cascade at all. This is the CONTROL: if
 *     it also showed two renders per ancestor, the finding would be about
 *     something other than the cascade.
 *
 * This mirrors `examples/photo-gallery`, where the behaviour was first noticed:
 * `/album/:slug` (AlbumView) keeps its instance while its `<Slot/>` child swaps
 * between the index and a photo — divergence below a reused ancestor, exactly
 * the first shape.
 */

// These are ROUTED views, not stage components, so they live in app/views and
// app/layouts — `codegen.ModeForPath` compiles those two directories as views
// (which is what makes `<Slot/>` legal) and everything else as a component.
import RcLayout from './layouts/RcLayout.pzl';
import RcLeaf from './views/RcLeaf.pzl';
import RcNode from './views/RcNode.pzl';
import { RC_LEAF_COUNT, RC_SEGMENTS } from './rc-paths.js';

/**
 * One view CLASS per level.
 *
 * Subclassing the compiled RcNode is what gives each chain position its own
 * identity: codegen attaches the template as `RcNode.prototype.render`, so a
 * subclass inherits it byte-for-byte and differs only in the `level` its
 * counters are filed under. `level` is a PROTOTYPE getter rather than a class
 * field so it is readable during construction, before field initializers run.
 *
 * Distinct classes also give each level a distinct vnode TAG, which keeps the
 * keyed component patch unambiguous when two adjacent levels would otherwise
 * be indistinguishable.
 */
function levelClass(level) {
	const Level = class extends RcNode {
		get level() {
			return level;
		}
	};
	// Named for the DevTools view tree and devstate's HMR keying, both of which
	// key on constructor.name — five anonymous classes would collide.
	Object.defineProperty(Level, 'name', { value: `RcLevel${level}`, configurable: true });
	return Level;
}

const LEVEL_VIEWS = [1, 2, 3, 4, 5].map(levelClass);

/** The 50 static leaves. Each carries its own id in meta — see RcLeaf.pzl. */
function leafRoutes() {
	const routes = new Array(RC_LEAF_COUNT);
	for (let i = 0; i < RC_LEAF_COUNT; i += 1) {
		routes[i] = {
			path: `leaf-${i}`,
			name: `rc-leaf-${i}`,
			view: RcLeaf,
			meta: { leafId: i },
		};
	}
	return routes;
}

/**
 * Build the nested chain bottom-up: level 5 holds the leaves, level 4 holds
 * level 5, and so on. Only level 1 carries the layout (layout is ROOT-only).
 */
export function rcRoutes() {
	let children = [
		...leafRoutes(),
		// The params-only control. Deliberately a SIBLING of the static leaves so
		// both arms share all five ancestors and differ ONLY in whether the chain
		// node identity changes.
		{ path: 'p/:id', name: 'rc-param', view: RcLeaf },
	];

	for (let level = 5; level >= 1; level -= 1) {
		const node = {
			path: RC_SEGMENTS[level - 1],
			name: `rc-level-${level}`,
			view: LEVEL_VIEWS[level - 1],
			children,
		};
		if (level === 1) {
			node.path = '/rc';
			node.layout = RcLayout;
			node.meta = { title: 'route-churn · Puzzle Stress Lab' };
		}
		children = [node];
	}

	return children;
}

export default rcRoutes;
