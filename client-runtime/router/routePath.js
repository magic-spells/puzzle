/**
 * Route-path shape shared by the browser Router and the Node prerender pass.
 *
 * A dynamic segment is only a complete `:name`-style segment. Colons and stars
 * anywhere else are literal static text because makeEntry regex-escapes every
 * non-dynamic segment in full.
 */
export function isDynamicSegment(segment) {
	return segment.length > 1 && segment[0] === ':';
}

/**
 * Top-level routes are path-shaped (`/about`) except for the bare `*` catch-all.
 * Empty and relative paths are unreachable from intercepted links, so reject
 * them at construction instead of allowing a route the app cannot navigate to.
 */
export function validateTopLevelPath(path) {
	if (path === '*') return;
	if (typeof path !== 'string' || path === '' || path[0] !== '/') {
		throw new Error(
			`[puzzle] top-level route path must be "*" or start with "/": "${String(path)}"`
		);
	}
}

/**
 * Find fully-static leaf entries hidden by an earlier matcher. Entries are the
 * Router's ordered compiled leaves and carry:
 *   - fullPath: the route-table spelling used in diagnostics
 *   - matchPath: the normalized pathname tested by the Router
 *   - regex: the compiled matcher
 *
 * The returned indexes identify occurrences, not just path strings, so duplicate
 * static declarations do not cause the first (reachable) occurrence to be
 * skipped by the prerenderer.
 */
export function findShadowedPaths(entries) {
	const shadowed = [];
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const fullPath = entry.fullPath ?? entry.fullPaths[entry.fullPaths.length - 1];
		if (fullPath === '*' || fullPath.split('/').some(isDynamicSegment)) continue;

		const matchPath = entry.matchPath ?? fullPath;
		for (let earlierIndex = 0; earlierIndex < index; earlierIndex++) {
			const earlier = entries[earlierIndex];
			if (!earlier.regex?.test(matchPath)) continue;
			shadowed.push({
				index,
				path: fullPath,
				shadowedBy:
					earlier.fullPath ?? earlier.fullPaths[earlier.fullPaths.length - 1],
			});
			break;
		}
	}
	return shadowed;
}
