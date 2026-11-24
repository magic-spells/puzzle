/**
 * routeNames — named route targets (D196).
 *
 * A navigation target is either a path string (`'/albums/7'`) or a named
 * target (`{ name: 'album', params: { id: 7 }, query, hash }`). This module
 * turns a named target back into the path string the rest of the router
 * already understands, so every consumer resolves names by one rule:
 *
 * - the live Router (url / push / replace / prefetch), in every routing mode;
 * - the hybrid prerender's url() shadow and the static router stub
 *   (ssg/index.js, ssg/assemble.js), so a prerendered href and the client's
 *   re-render can never disagree;
 * - the static page kernel (static/index.js), which reads the table from the
 *   page's names island instead of a route table it does not ship.
 *
 * It is DOM-free and imports only the shared tree helpers, so it runs
 * unchanged in the browser bundle and under Node (the routeTree.js
 * discipline).
 */

import { joinPath } from './routeTree.js';
import { isDynamicSegment } from './routePath.js';

/** @import { Route, NamedRouteTarget } from '../../types/index.js' */

/**
 * The name table: route name → the route's full path pattern
 * (`'/albums/:id'`), or null for the catch-all, which has no URL of its own.
 * @typedef {Map<string, string | null>} RouteNameTable
 */

// the keys a named target may carry. anything else is a typo (`param`,
// `path`) that would otherwise be dropped without a word.
const TARGET_KEYS = ['name', 'params', 'query', 'hash'];

/**
 * build the name table from the app's route definitions. every node that sets
 * a string `name` is registered under its full path, parents and index
 * children included, so `{ name: 'settings' }` resolves to `/settings` the
 * same way `{ name: 'settings-profile' }` resolves to `/settings/profile`.
 *
 * in development a name used by two different route nodes throws at startup
 * (the router constructor calls this); production keeps the first one.
 *
 * @param {ReadonlyArray<Route>} routes the top-level route definitions
 * @returns {RouteNameTable}
 */
export function routeNames(routes) {
	/** @type {RouteNameTable} */
	const table = new Map();

	/**
	 * register one node and recurse into its children.
	 * @param {Route} node
	 * @param {string | null} parentPath the parent's full path, null at the top
	 */
	const visit = (node, parentPath) => {
		// the catch-all only exists at the top level (the router throws on a
		// nested one), and it keeps a null pattern: it matches every url, so it
		// has none to give back.
		const fullPath =
			node.path === '*' && parentPath == null ? null : parentPath == null ? node.path : joinPath(parentPath, node.path);
		const name = node.name;
		if (typeof name === 'string') {
			if (!table.has(name)) table.set(name, fullPath);
			else if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				// one name, one route: link({ name }) has to know where it goes.
				// production keeps the first claim.
				throw new Error(
					`[puzzle] route name "${name}" is used by two routes ("${table.get(name) ?? '*'}" and "${fullPath ?? '*'}") — route names must be unique`
				);
			}
		}
		// a malformed path is reported by the router's own checks, which run
		// first; this walk only follows well-formed children.
		if (node.children && typeof fullPath === 'string') {
			for (const child of node.children) visit(child, fullPath);
		}
	};

	for (const route of routes) visit(route, null);
	return table;
}

/**
 * turn a name table into the plain object a static page's names island
 * carries (`{ album: '/albums/:id' }`). the catch-all is left out: it has no
 * url to resolve to, and the prerender has already thrown on any link to it.
 *
 * @param {RouteNameTable} table
 * @returns {Record<string, string>}
 */
export function routeNamesJSON(table) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const [name, pattern] of table) if (pattern != null) out[name] = pattern;
	return out;
}

/**
 * the path a navigation target stands for: a string is returned as written
 * (url()/push() keep their path rules), and a named target is resolved
 * against the table. anything else throws, as url() always has for a
 * non-string.
 *
 * @param {string | NamedRouteTarget} target
 * @param {RouteNameTable} names
 * @returns {string}
 */
export function targetPath(target, names) {
	if (typeof target === 'string') return target;
	// one check covers null, numbers, arrays and an object with no name: each
	// is neither a path nor a target.
	const name = target?.name;
	if (typeof name !== 'string' || name === '') {
		throw new Error(
			`[puzzle] expected a path string or a { name, params } route target (got ${
				target === null ? 'null' : Array.isArray(target) ? 'an array' : typeof target == 'object' ? 'no name' : typeof target
			})`
		);
	}
	const { params, query, hash } = target;
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		// a misspelled key (`param`, `path`) would otherwise vanish silently.
		for (const key of Object.keys(target)) {
			if (!TARGET_KEYS.includes(key)) {
				throw new Error(
					`[puzzle] route target "${name}" has an unknown key "${key}" — a target takes name, params, query and hash`
				);
			}
		}
	}

	const pattern = names.get(name);
	if (pattern === undefined) {
		throw new Error(
			`[puzzle] unknown route name "${name}"` +
				(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__
					? names.size
						? ` (named routes: ${[...names.keys()].join(', ')})`
						: ' — no route in the table has a name'
					: '')
		);
	}
	if (pattern === null) {
		throw new Error(`[puzzle] route "${name}" is the catch-all and has no URL to link to`);
	}

	// fill the pattern segment by segment, the way makeEntry compiles it: only
	// a whole `:name` segment is a param, so `v1:beta` stays literal text.
	const path = pattern
		.split('/')
		.map((segment) => {
			if (!isDynamicSegment(segment)) return segment;
			const value = params?.[segment.slice(1)];
			// a missing param would build a url no route matches; say which one.
			if (value == null || value === '') {
				throw new Error(`[puzzle] route "${name}" (${pattern}) needs the param "${segment.slice(1)}"`);
			}
			// encodeURIComponent keeps a `/`, `?` or `#` in a value from changing
			// the url's shape; the router decodes each matched segment, so data()
			// gets the value back exactly as it was passed (as a string).
			return encodeURIComponent(String(value));
		})
		.join('/');

	if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && params != null) {
		// a param the pattern never uses is usually a typo for one it does.
		for (const key of Object.keys(params)) {
			if (!pattern.split('/').includes(':' + key)) {
				throw new Error(`[puzzle] route "${name}" (${pattern}) has no param "${key}"`);
			}
		}
	}

	return path + queryString(query) + hashString(hash);
}

/**
 * a query object as `?a=1&tag=x&tag=y` (empty when nothing is set). an array
 * repeats the key, as `this.route.query` reads it back; null and undefined
 * values are left out, so `{ q: filter || null }` drops an empty filter.
 *
 * @param {NamedRouteTarget['query']} query
 * @returns {string}
 */
function queryString(query) {
	const search = new URLSearchParams();
	// `[value].flat()` treats one value and an array of them alike; append()
	// stringifies numbers and booleans itself.
	for (const [key, value] of Object.entries(query ?? {})) {
		for (const item of [value].flat()) if (item != null) search.append(key, /** @type {string} */ (item));
	}
	const out = search.toString();
	return out && '?' + out;
}

/**
 * a hash as `#faq` — written with or without its `#` (empty when unset).
 * @param {NamedRouteTarget['hash']} hash
 * @returns {string}
 */
function hashString(hash) {
	return !hash || hash === '#' ? '' : hash[0] === '#' ? hash : '#' + hash;
}
