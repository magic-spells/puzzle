/**
 * Ambient environment for type-checking client-runtime/ (`npm run
 * test:runtime-types`, tsconfig.runtime.json). Type-only and never shipped:
 * nothing here reaches a bundle or the published types/.
 */

// Build flags. The compiler substitutes each through esbuild `define`
// (compiler/internal/build bundleDefines); the runtime reads them behind a
// `typeof X === 'undefined'` guard so an unbundled import (vitest, SSG) still
// runs.
declare const __PUZZLE_DEV__: boolean;
declare const __PUZZLE_TAKEOVER__: boolean;
declare const __PUZZLE_CAPTURE__: boolean;
declare const __PUZZLE_HAS_I18N__: boolean;
declare const __PUZZLE_HAS_PORTAL__: boolean;
declare const __PUZZLE_HAS_SNIPPETS__: boolean;
declare const __PUZZLE_HAS_RAW_HTML__: boolean;
declare const __PUZZLE_HAS_RAW_AT__: boolean;
declare const __PUZZLE_HAS_RAW_SANITIZE__: boolean;
declare const __PUZZLE_HAS_LAZY__: boolean;
declare const __PUZZLE_HAS_FLIP__: boolean;

interface Window {
	/** The mounted app, published in dev builds for the DevTools bridge. */
	__PUZZLE_APP__?: any;
	/** Installed by the DevTools extension at document_start. */
	__PUZZLE_DEVTOOLS_HOOK__?: any;
	/** The DevTools console handle to the last inspected view or record (devtools.js). */
	$p?: unknown;
}

// The optional morph peer ships no declarations; types/morph.d.ts publishes the
// engine surface morph.js uses, so the constructor returns exactly that.
declare module '@magic-spells/morph-engine' {
	export const MorphEngine: new (
		options?: Record<string, any>
	) => import('../../types/morph.js').MorphEngine;
}

// The SSG entry (client-runtime/ssg) runs under Node and imports two builtins.
// @types/node is deliberately not loaded: its globals (a NodeJS.Timeout-typed
// setTimeout, `process`, `require`) would leak into the browser runtime's
// check. These shims cover exactly the calls the SSG makes.
declare module 'node:fs' {
	function readFileSync(path: string, encoding: 'utf8'): string;
	const promises: {
		mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
		writeFile(path: string, data: string): Promise<void>;
	};
	const fs: { readFileSync: typeof readFileSync; promises: typeof promises };
	export default fs;
}

declare module 'node:path' {
	const path: {
		join(...parts: string[]): string;
		dirname(p: string): string;
		relative(from: string, to: string): string;
		isAbsolute(p: string): boolean;
	};
	export default path;
}
