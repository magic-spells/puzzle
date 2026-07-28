/**
 * PRODUCTION-VISIBLE per-level counters for `route-churn`.
 *
 * Same reasoning as row-metrics.js and nest-metrics.js: the framework's own
 * structural counters live in `client-runtime/devperf.js`, which production
 * compiles out entirely. The decisive numbers for this scenario — how many
 * times each REUSED ancestor runs data(), how many times it renders, and how
 * many of those renders mutated nothing — have to survive into the shipped
 * bundle, so they are plain integers incremented by the scenario's own views.
 *
 * ── The level index ────────────────────────────────────────────────────────
 * A route-churn chain is  layout → node1 → node2 → node3 → node4 → node5 → leaf.
 * Every counter here is an array indexed by that position:
 *
 *   0        RcLayout    the reused ROOT LAYOUT (chrome, refreshed POST-commit)
 *   1 … 5    RcNode      the five nested ancestors (refreshed PRE-commit)
 *   6        RcLeaf      the routed leaf, which is FRESH on every navigation
 *
 * ── Why renders are counted with a nested getter ───────────────────────────
 * `PuzzleView.#recompose()` rebuilds the visible data as
 * `{ ...#local, ...#model }` — a SPREAD, which invokes any getter sitting on
 * the top level of what data() returned. A top-level getter would therefore
 * fire once per data() RUN and count exactly the thing dataRuns already counts.
 *
 * So the render counter hangs one level down (`probe.tick`), where the spread
 * copies the object REFERENCE and never reads through it. The template
 * interpolates `{ probe.tick }` once, so the getter fires once per render()
 * — including the slot-only re-renders that `applyParentUpdate()` drives
 * WITHOUT re-running data(), which is the entire phenomenon under measurement.
 * It returns a constant string, so it can never itself cause a DOM mutation and
 * contaminate the zero-mutation assertion sitting next to it. (`islands` uses
 * the same trick for the same reason.)
 */

/** layout + 5 nested ancestors + leaf. */
export const RC_LEVELS = 7;

/** The layout's index, and the leaf's — named so call sites do not use magic numbers. */
export const RC_LAYOUT_LEVEL = 0;
export const RC_LEAF_LEVEL = 6;

/** The constant every level's render getter returns. Never varies ⇒ never mutates. */
export const RC_TICK = '·';

const zeros = () => new Array(RC_LEVELS).fill(0);

export const rcMetrics = {
	/** data() executions, per level. */
	dataRuns: zeros(),
	/** render() executions, per level — includes slot-only re-renders. */
	renders: zeros(),
	/** DOM mutations observed inside each level's own element, per level. */
	mutations: zeros(),
	/**
	 * Navigations the OP verified as committed (the router's current path
	 * actually moved to the requested one). Counted by the scenario rather than
	 * by a lifecycle hook, because the params-only arm reuses the leaf INSTANCE
	 * and so never remounts it — a mount-based commit counter would read zero
	 * there and quietly invalidate the control.
	 */
	commits: 0,
	/**
	 * RcLeaf.mounted() calls. Deliberately separate from `commits`: a SUPERSEDED
	 * navigation constructs its destination leaf and runs its data(), then
	 * destroys it without ever mounting. `dataRuns[6] - leafMounts` is therefore
	 * exactly the work spent on destinations that never reached the screen.
	 */
	leafMounts: 0,
};

export function resetRcMetrics() {
	rcMetrics.dataRuns = zeros();
	rcMetrics.renders = zeros();
	rcMetrics.mutations = zeros();
	rcMetrics.commits = 0;
	rcMetrics.leafMounts = 0;
}

/** A frozen copy, so a stray render after an op cannot perturb what stats() reports. */
export function snapshotRcMetrics() {
	return {
		dataRuns: [...rcMetrics.dataRuns],
		renders: [...rcMetrics.renders],
		mutations: [...rcMetrics.mutations],
		commits: rcMetrics.commits,
		leafMounts: rcMetrics.leafMounts,
	};
}

/**
 * Sum a per-level array over the REUSED ancestors only — levels 0..5, i.e.
 * everything except the leaf, which is freshly constructed on every navigation
 * and is therefore not part of the reuse question.
 */
export function sumAncestors(arr) {
	let total = 0;
	for (let i = RC_LAYOUT_LEVEL; i < RC_LEAF_LEVEL; i += 1) total += arr[i];
	return total;
}
