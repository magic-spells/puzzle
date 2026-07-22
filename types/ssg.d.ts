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

/** A prerendered page. `html`/`title` are null for a `prerender: false` route. */
export interface PrerenderedPage {
	/** The route's full path (`/`, `/components/panel-stack`, …). */
	path: string;
	/** The rendered content markup, or null for a `prerender: false` page. */
	html: string | null;
	/** The resolved `<title>` (nearest meta.title leaf→root), or null. */
	title: string | null;
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
}

/** The summary returned by `prerenderToDir`. */
export interface PrerenderToDirResult {
	outDir: string;
	written: WrittenPage[];
	skipped: SkippedRoute[];
	warnings: string[];
	count: number;
}

/** Options for `prerenderToDir`. */
export interface PrerenderToDirOptions {
	/** Directory to write the per-route `index.html` files into. */
	outDir: string;
	/** Path to the app shell HTML (the built index.html) to inject pages into. */
	shellPath: string;
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
 * Inject rendered markup + a resolved title into an app shell by string surgery.
 * Stamps `data-puzzle-ssg` on the target element; throws if it is missing or
 * non-empty.
 */
export declare function injectShell(
	shell: string,
	fields: { targetId: string; content: string; title: string | null }
): string;
