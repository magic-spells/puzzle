/**
 * App error reporting funnel.
 *
 * Keep the handler out of ctx itself: ctx is the documented three-service
 * object, while this WeakMap gives every runtime owner holding that ctx the
 * same reporter without widening the public context surface.
 */

const CONFIG = new WeakMap();

/**
 * The config registered for this ctx or, failing that, for the ctx it derives
 * from. D161 gives every view on an adapter app its own store handle by
 * prototype-chaining a per-view ctx off the app's, so the object a view hands
 * back here is not the object app.mount() registered. Walking the chain keeps
 * the lookup LIVE — a later setErrorHandler on the app ctx reaches every view —
 * which snapshotting the config into each derived ctx would not.
 */
function configFor(ctx) {
	for (let target = ctx; target; target = Object.getPrototypeOf(target)) {
		const found = CONFIG.get(target);
		if (found) return found;
	}
	return undefined;
}

/** Register the app's error config for one mounted ctx lifetime. */
export function setErrorConfig(ctx, handler, errorView) {
	if (typeof handler === 'function' || errorView) CONFIG.set(ctx, { handler, errorView });
	else CONFIG.delete(ctx);
}

/** Update only the reporter while preserving the app-level error view. */
export function setErrorHandler(ctx, handler) {
	setErrorConfig(ctx, handler, configFor(ctx)?.errorView);
}

/** The app's ordinary PuzzleView constructor used for replacement error UI. */
export function getErrorView(ctx) {
	return (ctx && configFor(ctx)?.errorView) ?? null;
}

/**
 * Report one framework-contained error. With no app hook, replay the exact
 * console.error call supplied by the catch site. A throwing or rejecting
 * onError is contained here and is never sent through the funnel recursively.
 */
export function reportError(ctx, error, info, ...consoleArgs) {
	const handler = ctx && configFor(ctx)?.handler;
	const stableInfo = Object.freeze({
		phase: info.phase,
		view: info.view ?? null,
		route: info.route ?? null,
	});
	if (!handler) {
		if (consoleArgs.length) console.error(...consoleArgs);
		return stableInfo;
	}

	try {
		const result = handler(error, stableInfo);
		if (result != null && typeof result.then === 'function') {
			Promise.resolve(result).catch(logHandlerError);
		}
	} catch (handlerError) {
		logHandlerError(handlerError);
	}
	return stableInfo;
}

function logHandlerError(error) {
	console.error('[puzzle] onError hook failed:', error);
}
