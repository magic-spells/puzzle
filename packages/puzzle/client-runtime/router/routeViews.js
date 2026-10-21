/**
 * routeViews — `router.views` and the `agent` route field (D183).
 *
 * `router.views` is the route table as data a tool can read: one frozen entry
 * per leaf, in declaration order, with the catch-all left out. The router's
 * getter builds it once, on first read, from its compiled entries.
 *
 * `agent` is a top-level route field (a sibling of `guard`/`layout`, per D87):
 * `false` hides a route, `{ name, about }` names and describes it. It resolves
 * nearest-defined leaf→root, so a parent's `false` hides its subtree and a
 * child's own object re-exposes that child. Puzzle never acts on it — no
 * navigation is blocked, and the prerender ignores it; consumers filter
 * `router.views`.
 *
 * The dev checks are module functions, not Router members: every call sits
 * behind the __PUZZLE_DEV__ probe, so production drops the calls and then the
 * functions and their once-state (the router.js dev-warning pattern).
 */

import { resolveHeadField } from '../head.js';

/** @import { Route, RouteView } from '../../types/index.js' */
/** @import { RouteEntry } from './router.js' */

/**
 * Nearest-defined `agent` leaf→root: `undefined` keeps walking.
 * @param {ReadonlyArray<Route>} chain route defs root→leaf
 * @returns {RouteView['agent']}
 */
function resolveAgent(chain) {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].agent !== undefined) return chain[i].agent;
	}
	return undefined;
}

/**
 * One frozen entry per compiled leaf, in declaration order.
 * @param {ReadonlyArray<RouteEntry>} entries the router's leaf entries (no catch-all)
 * @returns {readonly RouteView[]}
 */
export function routeViews(entries) {
	return Object.freeze(
		entries.map(({ chain, fullPath, paramNames }) =>
			Object.freeze({
				path: fullPath,
				params: Object.freeze([...paramNames]),
				name: chain[chain.length - 1].name,
				meta: chain[chain.length - 1].meta,
				// resolveHeadField's null covers both "nothing defined" and an
				// explicit null suppression; neither is a title.
				title: resolveHeadField(chain, 'title') ?? undefined,
				agent: resolveAgent(chain),
				chain: Object.freeze([...chain]),
			})
		)
	);
}

// ---- dev-only checks ---------------------------------------------------------

/** Warn once per message even when the SSG pass builds several routers. */
const warned = new Set();
/** @param {string} message */
function warnOnce(message) {
	if (warned.has(message)) return;
	warned.add(message);
	console.warn(message);
}

/**
 * Validate every `agent` value in the route table, then warn about duplicate
 * names and, once any route declares `agent`, about the leaves it leaves
 * undescribed. Dev-only: call it behind the __PUZZLE_DEV__ probe.
 *
 * @param {ReadonlyArray<RouteEntry>} entries the router's leaf entries
 * @param {RouteEntry | null} catchAll the catch-all entry, validated but never listed
 */
export function checkAgentRoutes(entries, catchAll) {
	let declared = false;
	for (const { chain } of catchAll
		? [...entries, catchAll]
		: entries) {
		for (const node of chain) {
			const value = node.agent;
			if (value === undefined) continue;
			declared = true;
			if (
				value !== false &&
				!(
					value !== null &&
					typeof value === 'object' &&
					typeof value.name === 'string' &&
					(value.about === undefined ||
						typeof value.about === 'string')
				)
			) {
				throw new Error(
					`[puzzle] agent on route ${JSON.stringify(node.path)} must be false or ` +
						`{ name: string, about?: string } (got ${value === null ? 'null' : typeof value === 'object' ? 'an object without a string name' : typeof value})`
				);
			}
		}
	}
	if (!declared) return;
	/** @type {Map<string, string>} */
	const names = new Map();
	/** @type {string[]} */
	const silent = [];
	for (const { chain, fullPath } of entries) {
		const agent = resolveAgent(chain);
		if (agent === undefined) {
			silent.push(fullPath);
		} else if (agent) {
			const first = names.get(agent.name);
			if (first === undefined) names.set(agent.name, fullPath);
			else {
				warnOnce(
					`[puzzle] agent name ${JSON.stringify(agent.name)} is used by both "${first}" and "${fullPath}"`
				);
			}
		}
	}
	if (silent.length) {
		warnOnce(
			`[puzzle] these routes have no agent field (set agent: { name, about } or agent: false): ${silent
				.map((path) => `"${path}"`)
				.join(', ')}`
		);
	}
}
