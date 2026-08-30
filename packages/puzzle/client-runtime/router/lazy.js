/**
 * Lazy route-view markers (D163).
 *
 * `lazy(loader)` is the explicit boundary between a PuzzleView constructor and
 * a function that loads one. Route validation never guesses which kind of
 * function it received: a loader is accepted only through the branded marker
 * stored in this module's WeakMap.
 *
 * Every reference to this module from router.js sits behind the
 * `__PUZZLE_HAS_LAZY__` probe (D89 pattern), so an app whose source never calls
 * `lazy()` folds all three call sites dead and tree-shakes the whole module
 * out. That is why `validateRouteView` lives in router.js and the shared
 * class-shape helpers live in viewClass.js: route validation runs in every app,
 * lazy or not, and must not be what keeps the resolver alive.
 */

import { describeValue, isViewClass } from './viewClass.js';

const lazyViews = new WeakMap();

/**
 * Mark a zero-argument async loader for use in a route `view` or `layout`.
 * Fulfillment is memoized for the marker's lifetime; rejection clears the
 * in-flight slot so an explicit retry calls the loader again.
 */
export function lazy(loader) {
	// Config-time throws are plain Errors, matching the route-shape validators
	// (validateGuard/validateTransitionMode) this sits beside. Only the load-time
	// failures below — the ones that reach onError as a navigation-phase error —
	// are TypeErrors.
	if (typeof loader !== 'function') {
		throw new Error(`[puzzle] lazy() expects a loader function (got ${typeof loader})`);
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

/** Whether any class position in an entry is lazy. */
export function hasLazyRouteViews(entry) {
	return entry.chain.some((node) => isLazyView(node.view)) || isLazyView(entry.layout);
}

/**
 * Resolve every view/layout position in one matched entry. All lazy markers are
 * started before Promise.all awaits any one of them, so nested chains and their
 * layout load in parallel. Entries whose markers all resolved earlier stay
 * synchronous, so a warm lazy route adds no microtask to the navigation.
 *
 * Each position's diagnostic label is a THUNK: it names the route and chain
 * index, and only a failing load ever pays to build that string.
 *
 * @returns {{ views: Function[], layout: Function|null }|Promise<{ views: Function[], layout: Function|null }>}
 */
export function resolveRouteViews(entry) {
	const chain = entry.chain;
	const resolved = new Array(chain.length + 1);
	let awaited = false;
	for (let i = 0; i < chain.length; i++) {
		const value = chain[i].view;
		if (isLazyView(value)) {
			const position = resolveLazyView(value, () => viewLabel(entry, i));
			if (isPromiseLike(position)) awaited = true;
			resolved[i] = position;
		} else {
			resolved[i] = value ?? null;
		}
	}
	const layout = entry.layout;
	if (isLazyView(layout)) {
		const position = resolveLazyView(layout, () => layoutLabel(entry));
		if (isPromiseLike(position)) awaited = true;
		resolved[chain.length] = position;
	} else {
		resolved[chain.length] = layout ?? null;
	}
	if (!awaited) return splitResolved(resolved);
	return Promise.all(resolved).then(splitResolved);
}

/** The matched leaf path, however the caller's entry shape spells it. */
function entryPath(entry) {
	return entry.fullPath ?? entry.fullPaths?.[entry.fullPaths.length - 1] ?? '(unknown)';
}

function viewLabel(entry, index) {
	const path = entryPath(entry);
	const declared = entry.chain[index].path ?? path;
	return `view on route ${JSON.stringify(declared)} (matched ${JSON.stringify(path)}, chain index ${index})`;
}

function layoutLabel(entry) {
	return `layout for route ${JSON.stringify(entryPath(entry))}`;
}

function splitResolved(resolved) {
	return { views: resolved.slice(0, -1), layout: resolved[resolved.length - 1] };
}

function resolveLazyView(marker, label) {
	const state = lazyViews.get(marker);
	if (state.value) return state.value;
	// Concurrent navigations to routes sharing a marker share ONE in-flight load.
	// The settle handlers below clear `pending` before any consumer of this promise
	// observes the outcome, so a retry after a rejection always reaches the loader
	// again and a fulfillment is never re-run.
	if (state.pending) return state.pending;

	state.pending = Promise.resolve()
		.then(() => {
			const result = state.loader();
			if (!isPromiseLike(result)) {
				throw new TypeError(`[puzzle] ${label()}: lazy() loader must return a promise`);
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
			const source = modulePath ? JSON.stringify(modulePath) : `the module loaded for ${label()}`;
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
			`[puzzle] ${label()}: lazy() resolved${source} to ${describeValue(ViewClass)}, ` +
				'not a PuzzleView class'
		);
	}
	return ViewClass;
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
