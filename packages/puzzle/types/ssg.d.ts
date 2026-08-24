/**
 * Declarations for the `@magic-spells/puzzle/ssg` subpath (M1) — the static site
 * generation prerender step. Mirrors client-runtime/ssg/index.js.
 *
 * Node-only: `prerenderToDir` reads/writes files. `prerender` is the DOM-free,
 * filesystem-free core that returns the rendered pages. Both take the PuzzleApp
 * config (the default-exported app's `app.config`, or a bare config object).
 *
 * Pragmatic, not exhaustive — matches the loose typing of the root declarations
 * (the config surface is the same `any`-tolerant shape PuzzleApp accepts).
 */

/**
 * The resolved reserved head fields for a route (v1.50, D84 — SPEC §45): each
 * field is the nearest-defined `meta` value walking the chain leaf→root
 * (`undefined` inherits, `null` suppresses), or null when nothing resolves.
 */
export interface ResolvedRouteHead {
	title: string | null;
	description: string | null;
	canonical: string | null;
	socialImage: string | null;
}

/**
 * What a prerendered page's records cannot say on their own (v1.76, D161): the
 * adapter read state the build settled, handed to the browser kernel in its own
 * island so `mountStatic` does not refetch what prerender already resolved.
 * Versioned so an older kernel can reject a newer envelope.
 */
export interface PrerenderReadState {
	/** Envelope version — `1` today; a kernel rejects anything it does not know. */
	v: number;
	/** Model type names settled collection-complete by a no-options load. */
	complete: string[];
	/** Identity keys (`type` + separator + `id`) settled as absent by a 404. */
	absent: string[];
}

/** A prerendered page. `html`/`title`/`head` are null for a `prerender: false` route. */
export interface PrerenderedPage {
	/** The route's full path (`/`, `/components/panel-stack`, …). */
	path: string;
	/** The rendered content markup, or null for a `prerender: false` page. */
	html: string | null;
	/** The resolved `<title>` (=== `head.title`, kept for compatibility), or null. */
	title: string | null;
	/** The D84 per-field head resolution, or null for a `prerender: false` page. */
	head: ResolvedRouteHead | null;
	/** Present and `false` when the route opted out with `prerender: false`. */
	prerender?: boolean;
	/**
	 * The page's store snapshot (`Store._serializeAll()` — type name → serialized
	 * records) that rides into the inline data island — static mode only.
	 */
	data?: Record<string, any[]>;
	/**
	 * The adapter read state this page settled (D161) — static mode only, and
	 * attached only when the app has an adapter AND something was actually read,
	 * so an adapter-less page omits the key entirely.
	 */
	readState?: PrerenderReadState;
	/** The page's view/layout `__pzlModule` stamps — static mode only. */
	modules?: { views: string[]; layout: string | null };
	/** The page's plain-JSON route snapshot — static mode only. */
	route?: object;
	/** Enumerated but deliberately not rendered by a subset render (D155). */
	reused?: boolean;
}

/** One leaf entry from `enumerateRoutes` — the prerenderer's per-page unit. */
export interface RouteEntry {
	/** The leaf's composed full path (`/`, `/todos/:id`, `*`, …). */
	fullPath: string;
	/** The route defs root → leaf. */
	chain: any[];
	/** The top-level route's `layout` (children inherit it), or null. */
	layout: any | null;
}

/**
 * A route skipped by the prerender step: v1 skips `:param` routes and any `*`
 * that is NOT the top-level catch-all (the bare `path: '*'` renders to 404.html).
 */
export interface SkippedRoute {
	path: string;
	reason: string;
	/**
	 * The route's view/layout `__pzlModule` stamps — static mode only. A skipped
	 * route ships no page, but its views are still chain roots for the dev
	 * builder's render-wide walk (D155). A stamp the route does not carry is
	 * omitted rather than reported as an error.
	 */
	modules?: { views: string[]; layout: string | null };
}

/** The result of `prerender`. */
export interface PrerenderResult {
	pages: PrerenderedPage[];
	skipped: SkippedRoute[];
	warnings: string[];
}

/** One file written by `prerenderToDir`. */
export interface WrittenPage {
	path: string;
	file: string;
	prerender: boolean;
	/** The page's per-page module URL (`"_puzzle/<slug>.js"`) — static mode only. */
	entry?: string;
	/** The page's view/layout `__pzlModule` stamps — static mode only. */
	modules?: { views: string[]; layout: string | null };
	/** The page's plain-JSON route snapshot — static mode only. */
	route?: object;
	/**
	 * Set by a subset render (`only`): this page was enumerated and claimed its
	 * output path and slug, but was deliberately not rendered. `file` does not
	 * exist — the caller supplies the previous render's copy (D155).
	 */
	reused?: boolean;
}

/** The summary returned by `prerenderToDir`. */
export interface PrerenderToDirResult {
	outDir: string;
	written: WrittenPage[];
	skipped: SkippedRoute[];
	warnings: string[];
	count: number;
	/** Present only in `mode: 'static'` output (D79). */
	mode?: 'static';
	/** The mount target id (e.g. `"app"`) — static mode only. */
	target?: string;
	/** The store's base API URL, or null — static mode only. */
	apiURL?: string | null;
	/** The app's normalized route URL prefix — static mode only. */
	routerBase?: string;
	/** Whether the config registered any models — static mode only. */
	hasModels?: boolean;
	/** Whether the config registered any custom formatters — static mode only. */
	hasFormatters?: boolean;
	/** Whether the app passed the adapter capability — static mode only. */
	hasAdapter?: boolean;
	/**
	 * Whether that capability carries app-wide defaults (`adapter.defaults(...)`)
	 * rather than being the bare export — static mode only. A configured
	 * capability holds functions, so a page entry cannot re-create it and has to
	 * import the exact value instead.
	 */
	adapterConfigured?: boolean;
	/**
	 * Whether `options.adapterModule` IS `config.adapter` — static mode only, and
	 * `null` when no such module was passed.
	 */
	adapterModuleMatches?: boolean | null;
}

/** Options for `prerenderToDir`. */
export interface PrerenderToDirOptions {
	/** Directory to write the per-route `index.html` files into. */
	outDir: string;
	/** Path to the app shell HTML (the built index.html) to inject pages into. */
	shellPath: string;
	/**
	 * Output mode (D79): `'hybrid'` (default) is the router-takeover output,
	 * byte-identical to before. `'static'` emits true static pages (app.js stripped,
	 * per-page data island + module script, extended summary fields).
	 */
	mode?: 'hybrid' | 'static';
	/**
	 * Static mode only — render just these route paths (D155). Every other
	 * reachable route is still enumerated, still claims its output path and slug,
	 * and is still reported in `written` with `reused: true`, but no context is
	 * built for it and no file is written: the caller must place the previous
	 * render's file at the reported path. Omitted renders everything.
	 */
	only?: string[];
	/**
	 * Static mode only — the default export of the app's conventional
	 * `app/adapter.js`, so the summary can report whether it IS `config.adapter`
	 * (`adapterModuleMatches`). Present but `undefined` is a real answer (a module
	 * exporting no default); the KEY's absence is what means "no such module".
	 */
	adapterModule?: unknown;
}

/**
 * Prerender every static route in `config` to an HTML content string + title.
 * A route whose full path carries a `:param` (or a `*` that is not the top-level
 * catch-all) is skipped (recorded in `skipped` + `warnings`); the bare catch-all
 * (`path: '*'`) renders like a static route (its file lands at 404.html); a
 * `prerender: false` route yields a null-html page. When no catch-all route
 * exists an advisory warning is pushed (no 404.html will be emitted).
 */
export declare function prerender(config: any, opts?: object): Promise<PrerenderResult>;

/**
 * Flatten a routes array into one entry PER LEAF via the shared route-tree walk
 * (routeTree.js) the Router compiles its matcher table from, so a navigable route
 * and its prerendered page can never disagree on the leaf set or composed path.
 * Exported for the drift-guard test.
 */
export declare function enumerateRoutes(routes: any[]): RouteEntry[];

/**
 * Prerender and write one directory-style `index.html` per route into `outDir`,
 * injecting each page into the shell at `shellPath`.
 */
export declare function prerenderToDir(
	config: any,
	options: PrerenderToDirOptions
): Promise<PrerenderToDirResult>;

/**
 * Inject rendered markup + a resolved title/head into an app shell by string
 * surgery. Stamps `data-puzzle-ssg` on the target element; throws if it is
 * missing or non-empty. With a resolved `head` (D84) the managed
 * `data-puzzle-head` tags are replaced/inserted/removed alongside the title;
 * with only a bare `title` the pre-D84 title-only path runs (no managed tags).
 */
export declare function injectShell(
	shell: string,
	fields: {
		targetId: string;
		content: string;
		title: string | null;
		head?: ResolvedRouteHead | null;
	}
): string;

/**
 * Static-mode (D79) shell surgery: stamp `data-puzzle-static` on the target (unless
 * `content` is null — a prerender:false page keeps an empty, unmarked target), inject
 * the inline JSON data island (with `<` escaped so `</script>` can't break out), the
 * read-state island beside it when `readState` is non-empty (D161), and the per-page
 * `/_puzzle/<slug>.js` module script, and replace the title. The caller has already
 * stripped the app-bundle `<script>` from `shell`.
 */
export declare function injectStaticShell(
	shell: string,
	fields: {
		targetId: string;
		content: string | null;
		title: string | null;
		head?: ResolvedRouteHead | null;
		slug: string;
		data: object;
		/**
		 * The page's settled read state (D161). Omitted or null emits no read
		 * island at all, so an adapter-less build produces the exact bytes it did
		 * before the envelope existed.
		 */
		readState?: PrerenderReadState | null;
		/**
		 * The already-normalized route base prefix (`''` for a root deploy) prepended
		 * to the per-page `/_puzzle/<slug>.js` module href so a sub-path deploy
		 * resolves it instead of 404ing at the domain root.
		 */
		base?: string;
	}
): string;
