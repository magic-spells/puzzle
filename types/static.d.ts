/**
 * Declarations for the `@magic-spells/puzzle/static` subpath (D79) — the static
 * output kernel. Mirrors client-runtime/static/index.js.
 *
 * Browser-only: `mountStatic` upgrades a prerendered static page to an interactive
 * document (rehydrate the data island, assemble + mount the route chain). No router
 * is involved — static pages navigate by plain links.
 *
 * Pragmatic, not exhaustive — matches the loose typing of the root declarations (the
 * view/layout classes are the same `any`-tolerant shape PuzzleApp accepts).
 */

/** A serialized route def (no classes) — one link of `StaticRoute.chain`. */
export interface StaticRouteDef {
	path: string;
	name?: string;
	meta?: Record<string, any>;
}

/** The plain-JSON route snapshot the prerender summary emits per page. */
export interface StaticRoute {
	path: string;
	params: Record<string, string>;
	chain: StaticRouteDef[];
}

/** Options for `mountStatic`. */
export interface MountStaticOptions {
	/** The `'#id'` selector for the mount element. */
	target: string;
	/** The route chain's view classes, root → leaf, matching `route.chain` order. */
	views: any[];
	/** The top-level layout class, or null. */
	layout?: any | null;
	/** The serialized route snapshot from the summary. */
	route: StaticRoute;
	/** The app models map. */
	models?: Record<string, any>;
	/** The app custom formatters map. */
	formatters?: Record<string, any>;
	/** The store's base API URL. */
	apiURL?: string;
}

/**
 * Mount a prerendered static page's interactive layer: wire the build-time ctx
 * (Store + FormatterRegistry, a throwing router stub), rehydrate the inline data
 * island, assemble + preload the route chain, and mount it over the prerendered
 * markup (flash-free, replace-on-commit). `beforeMount` is not run (build-time only).
 */
export declare function mountStatic(options: MountStaticOptions): Promise<void>;

export default mountStatic;
