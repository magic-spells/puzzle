/**
 * route-churn's path vocabulary — deliberately a leaf module.
 *
 * `stress-controller.js` needs the entry path (it maps the scenario name to a
 * real URL instead of `/?scenario=…`), RcLayout needs the path builders, and
 * `rc-routes.js` needs the segments. If those constants lived in `rc-routes.js`
 * the controller would import the routes, the routes would import RcLayout, and
 * RcLayout would import the controller — a cycle that happens to work under
 * ESM's live bindings and would break the first time someone read one of these
 * at module scope. This file imports nothing, so there is no cycle to reason
 * about.
 */

/** Static leaf routes. 50 is the brief's "~50"; it also keeps #match's linear scan honest. */
export const RC_LEAF_COUNT = 50;

/** Path segments, level 1 first. Level 1 owns the `/rc` mount point. */
export const RC_SEGMENTS = ['rc', 's2', 's3', 's4', 's5'];

/** `/rc/s2/s3/s4/s5` — the shared five-level prefix every leaf hangs off. */
export const RC_PREFIX = '/' + RC_SEGMENTS.join('/');

/**
 * The static leaf a navigation targets. Indices wrap, and consecutive indices
 * always name different leaves — which matters, because `router.push()` treats
 * a push to the already-committed path as a no-op and would silently turn a
 * measured navigation into nothing at all.
 */
export const rcLeafPath = (i) => `${RC_PREFIX}/leaf-${((i % RC_LEAF_COUNT) + RC_LEAF_COUNT) % RC_LEAF_COUNT}`;

/** The PARAMS-ONLY control leaf: one chain, one route node, only `:id` moves. */
export const rcParamPath = (id) => `${RC_PREFIX}/p/${id}`;

/** Where `__STRESS__.select('route-churn')` lands. */
export const RC_ENTRY_PATH = rcLeafPath(0);
