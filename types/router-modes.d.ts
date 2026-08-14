/**
 * Declarations for the `@magic-spells/puzzle/router-modes` subpath (D159).
 *
 * History routing is the Router's built-in default and needs no import. Hash
 * (D34) and memory (D42) routing are opt-in factories that live here, so an app
 * that never imports them never bundles them:
 *
 * ```ts
 * import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
 *
 * new PuzzleApp({ routerMode: hashRouter() });
 * ```
 *
 * Mirrors client-runtime/router/modes.js exactly.
 */

/**
 * A router mode, produced by `hashRouter()` or `memoryRouter()` and passed as
 * `routerMode`. OPAQUE: its members are an internal contract between the mode
 * module and the Router, never app API. Omitting `routerMode` selects history
 * routing; a mode STRING is a constructor error.
 */
export interface RouterMode {
	/** Diagnostic label only (`'hash'` / `'memory'`) — the Router never reads it. */
	readonly name: string;
	/** @internal builds the per-Router mode instance. */
	create(): unknown;
}

/**
 * Hash routing (v1.6, D34): carry the route in `location.hash` (`/#/user/123`)
 * instead of the pathname, for static hosts with no server-side rewrite. The
 * app-facing API stays path-shaped — `push('/user/123')`, `current.path` — and a
 * `routerBase` rides inside the fragment.
 */
export declare function hashRouter(): RouterMode;

/**
 * Memory routing (v1.11, D42): keep the route entirely in router state, never
 * reading or writing `location`/`history`. For tests and embedded apps that must
 * not touch the host page's URL, scroll, focus, or title. There is no URL to
 * read, so navigation #0 goes to `initialPath` (default `'/'`).
 */
export declare function memoryRouter(options?: { initialPath?: string }): RouterMode;
