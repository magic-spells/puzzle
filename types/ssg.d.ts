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
}

/**
 * A route skipped by the prerender step: v1 skips `:param` routes and any `*`
 * that is NOT the top-level catch-all (the bare `path: '*'` renders to 404.html).
 */
export interface SkippedRoute {
	path: string;
	reason: string;
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
	/** Whether the config registered any custom formatters — static mode only. */
	hasFormatters?: boolean;
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
 * the inline JSON data island (with `<` escaped so `</script>` can't break out) and
 * the per-page `/_puzzle/<slug>.js` module script, and replace the title. The caller
 * has already stripped the app-bundle `<script>` from `shell`.
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
	}
): string;
