/**
 * Lazy route-view markers (D163).
 *
 * `lazy(loader)` is the explicit boundary between a PuzzleView constructor and
 * a function that loads one. Route validation never guesses which kind of
 * function it received: a loader is accepted only through the branded marker
 * stored in this module's WeakMap.
 */

import { PuzzleView } from '../views/PuzzleView.js';

const lazyViews = new WeakMap();

/**
 * Mark a zero-argument async loader for use in a route `view` or `layout`.
 * Fulfillment is memoized for the marker's lifetime; rejection clears the
 * in-flight slot so an explicit retry calls the loader again.
 */
export function lazy(loader) {
	if (typeof loader !== 'function') {
		throw new TypeError(`[puzzle] lazy() expects a loader function (got ${typeof loader})`);
	}

	const marker = Object.freeze({});
	lazyViews.set(marker, {
		loader,
		modulePath: importSpecifier(loader),
		value: null,
		pending: null,
	});
	return marker;
}

/** Whether a route value is an opaque marker produced by lazy(). */
export function isLazyView(value) {
	return value != null && typeof value === 'object' && lazyViews.has(value);
}

/**
 * Fail fast while the route table is compiled. A bare function is never
 * treated as a possible loader; authors must opt in with lazy().
 */
export function validateRouteView(value, label) {
	if (isLazyView(value) || isViewClass(value)) return;
	if (typeof value === 'function') {
		throw new TypeError(
			`[puzzle] ${label} must be a PuzzleView class, not a loader function — ` +
				"wrap dynamic imports with lazy(() => import('./views/Page.pzl'))"
		);
	}
	throw new TypeError(
		`[puzzle] ${label} must be a PuzzleView class or lazy() marker (got ${describe(value)})`
	);
}

/** Whether any class position in an entry is lazy. */
export function hasLazyRouteViews(entry) {
	return entry.chain.some((node) => isLazyView(node.view)) || isLazyView(entry.layout);
}

/**
 * Resolve every view/layout position in one matched entry. All lazy markers are
 * started before Promise.all awaits any one of them, so nested chains and their
 * layout load in parallel. Entries with no markers stay synchronous.
 *
 * @returns {{ views: Function[], layout: Function|null }|Promise<{ views: Function[], layout: Function|null }>}
 */
export function resolveRouteViews(entry) {
	const path = entry.fullPath ?? entry.fullPaths?.[entry.fullPaths.length - 1] ?? '(unknown)';
	const positions = entry.chain.map((node, index) => ({
		value: node.view,
		label: `view on route ${JSON.stringify(node.path ?? path)} (matched ${JSON.stringify(path)}, chain index ${index})`,
	}));
	positions.push({
		value: entry.layout,
		label: `layout for route ${JSON.stringify(path)}`,
	});

	const resolved = positions.map(({ value, label }) =>
		value == null ? null : isLazyView(value) ? resolveLazyView(value, label) : value
	);
	if (!resolved.some(isPromiseLike)) return splitResolved(resolved);
	return Promise.all(resolved).then(splitResolved);
}

function splitResolved(resolved) {
	return { views: resolved.slice(0, -1), layout: resolved[resolved.length - 1] };
}

function resolveLazyView(marker, label) {
	const state = lazyViews.get(marker);
	if (state.value) return state.value;
	if (state.pending) return state.pending;

	state.pending = Promise.resolve()
		.then(() => {
			const result = state.loader();
			if (!isPromiseLike(result)) {
				throw new TypeError(`[puzzle] ${label}: lazy() loader must return a promise`);
			}
			return result;
		})
		.then((loaded) => normalizeLoadedView(loaded, state.modulePath, label))
		.then(
			(ViewClass) => {
				state.value = ViewClass;
				state.pending = null;
				return ViewClass;
			},
			(error) => {
				state.pending = null;
				throw error;
			}
		);
	return state.pending;
}

function normalizeLoadedView(loaded, modulePath, label) {
	let ViewClass = loaded;
	if (loaded != null && typeof loaded === 'object') {
		if (!Object.prototype.hasOwnProperty.call(loaded, 'default')) {
			const source = modulePath ? JSON.stringify(modulePath) : `the module loaded for ${label}`;
			throw new TypeError(
				`[puzzle] lazy route module ${source} has no default export — ` +
					'export the PuzzleView class as default'
			);
		}
		ViewClass = loaded.default;
	}

	if (!isViewClass(ViewClass)) {
		const source = modulePath ? ` from ${JSON.stringify(modulePath)}` : '';
		throw new TypeError(
			`[puzzle] ${label}: lazy() resolved${source} to ${describe(ViewClass)}, ` +
				'not a PuzzleView class'
		);
	}
	return ViewClass;
}

function isViewClass(value) {
	return (
		typeof value === 'function' &&
		(value === PuzzleView || value.prototype instanceof PuzzleView)
	);
}

function isPromiseLike(value) {
	return value != null && typeof value.then === 'function';
}

/** Extract a literal import path for the missing-default diagnostic when available. */
function importSpecifier(loader) {
	let source;
	try {
		source = Function.prototype.toString.call(loader);
	} catch {
		return null;
	}
	// The first form is authored JavaScript. The identifier form covers test/dev
	// transforms such as `__vite_ssr_dynamic_import__("./Page.pzl")` while still
	// requiring an import-named call with one literal argument.
	const match = source.match(
		/(?:\bimport|[A-Za-z_$][\w$]*import[\w$]*)\s*\(\s*(['"])([^'"]+)\1\s*\)/i
	);
	return match?.[2] ?? null;
}

function describe(value) {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return typeof value;
}
