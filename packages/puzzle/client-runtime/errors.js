/**
 * App error reporting funnel.
 *
 * Keep the handler out of ctx itself: ctx is the documented three-service
 * object, while this WeakMap gives every runtime owner holding that ctx the
 * same reporter without widening the public context surface.
 */

/** @import { PuzzleView } from './views/PuzzleView.js' */

/**
 * The app's onError (PuzzleAppConfig.onError, only ever called when it is a
 * function) and errorView constructor.
 * @typedef {{ handler: Function | null | undefined,
 *   errorView: (new (ctx?: object) => PuzzleView) | null | undefined }} ErrorConfig
 */

/**
 * What a catch site hands reportError; the funnel fills the missing fields with null.
 * @typedef {{ phase: import('../types/index.js').PuzzleErrorInfo['phase'],
 *   view?: PuzzleView | null, route?: import('../types/index.js').RouteSnapshot | null }} ErrorSite
 */

/**
 * The frozen info object handed to onError and returned to the catch site
 * (the runtime-side shape of the public PuzzleErrorInfo).
 * @typedef {Readonly<{ phase: ErrorSite['phase'], view: PuzzleView | null,
 *   route: import('../types/index.js').RouteSnapshot | null }>} ErrorInfo
 */

/** @type {WeakMap<object, ErrorConfig>} */
const CONFIG = new WeakMap();

/**
 * The config registered for this ctx or, failing that, for the ctx it derives
 * from. D161 gives every view on an adapter app its own store handle by
 * prototype-chaining a per-view ctx off the app's, so the object a view hands
 * back here is not the object app.mount() registered. Walking the chain keeps
 * the lookup LIVE — a later setErrorHandler on the app ctx reaches every view —
 * which snapshotting the config into each derived ctx would not.
 *
 * @param {object} ctx
 * @returns {ErrorConfig | undefined}
 */
function configFor(ctx) {
	for (let target = ctx; target; target = Object.getPrototypeOf(target)) {
		const found = CONFIG.get(target);
		if (found) return found;
	}
	return undefined;
}

/**
 * Register the app's error config for one mounted ctx lifetime.
 * @param {object} ctx
 * @param {ErrorConfig['handler']} handler
 * @param {ErrorConfig['errorView']} errorView
 */
export function setErrorConfig(ctx, handler, errorView) {
	if (typeof handler === 'function' || errorView) CONFIG.set(ctx, { handler, errorView });
	else CONFIG.delete(ctx);
}

/**
 * Update only the reporter while preserving the app-level error view.
 * @param {object} ctx
 * @param {ErrorConfig['handler']} handler
 */
export function setErrorHandler(ctx, handler) {
	setErrorConfig(ctx, handler, configFor(ctx)?.errorView);
}

/**
 * The app's ordinary PuzzleView constructor used for replacement error UI.
 * @param {object | null | undefined} ctx
 * @returns {ErrorConfig['errorView']}
 */
export function getErrorView(ctx) {
	return (ctx && configFor(ctx)?.errorView) ?? null;
}

/**
 * Report one framework-contained error. With no app hook, replay the exact
 * console.error call supplied by the catch site. A throwing or rejecting
 * onError is contained here and is never sent through the funnel recursively.
 *
 * @param {object | null | undefined} ctx
 * @param {unknown} error
 * @param {ErrorSite} info
 * @param {...unknown} consoleArgs
 * @returns {ErrorInfo}
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

/** @param {unknown} error */
function logHandlerError(error) {
	console.error('[puzzle] onError hook failed:', error);
}
