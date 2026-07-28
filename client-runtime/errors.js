/**
 * App error reporting funnel.
 *
 * Keep the handler out of ctx itself: ctx is the documented three-service
 * object, while this WeakMap gives every runtime owner holding that ctx the
 * same reporter without widening the public context surface.
 */

const HANDLERS = new WeakMap();

/** Register the app's optional onError hook for one mounted ctx lifetime. */
export function setErrorHandler(ctx, handler) {
	if (typeof handler === 'function') HANDLERS.set(ctx, handler);
	else HANDLERS.delete(ctx);
}

/**
 * Report one framework-contained error. With no app hook, replay the exact
 * console.error call supplied by the catch site. A throwing or rejecting
 * onError is contained here and is never sent through the funnel recursively.
 */
export function reportError(ctx, error, info, ...consoleArgs) {
	const handler = ctx && HANDLERS.get(ctx);
	if (!handler) {
		if (consoleArgs.length) console.error(...consoleArgs);
		return;
	}

	const stableInfo = Object.freeze({
		phase: info.phase,
		view: info.view ?? null,
		route: info.route ?? null,
	});

	try {
		const result = handler(error, stableInfo);
		if (result != null && typeof result.then === 'function') {
			Promise.resolve(result).catch(logHandlerError);
		}
	} catch (handlerError) {
		logHandlerError(handlerError);
	}
}

function logHandlerError(error) {
	console.error('[puzzle] onError hook failed:', error);
}
