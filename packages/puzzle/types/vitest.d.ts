/**
 * Public declarations for @magic-spells/puzzle/vitest (D193): the Vite plugin
 * that lets an app's Vitest suite import `.pzl` files.
 *
 * Declared structurally, without importing Vite's types, so the package takes
 * no dependency on Vite. The returned object fits Vite's `Plugin` wherever a
 * `plugins` array expects one.
 */

/** Options for `puzzle()`. */
export interface PuzzleVitestOptions {
	/**
	 * Path to a `puzzle` executable to run instead of the installed one (for
	 * example a compiler built from source). The `PUZZLE_BIN` environment
	 * variable does the same; this option wins.
	 */
	bin?: string;
}

/** Vitest's cache-key hook, as far as the plugin uses it. */
export type PuzzleCacheKeyHook = (
	generator: (module: {
		id: string;
		sourceCode: string;
	}) => string | false | undefined
) => void;

/** The plugin object `puzzle()` returns. */
export interface PuzzleVitePlugin {
	name: string;
	enforce: 'pre';
	/** Adds the build's `@/` app alias: `@/x` resolves to `<root>/app/x`. */
	config(config: { root?: string }): {
		resolve: { alias: { find: RegExp; replacement: string }[] };
	};
	/**
	 * Keys Vitest's on-disk module cache for `.pzl` files to the framework
	 * version, and opts out files that inline `{#svg}` assets or are compiled by
	 * a custom binary.
	 */
	configureVitest(context: {
		defineCacheKeyGenerator?: PuzzleCacheKeyHook;
		experimental_defineCacheKeyGenerator?: PuzzleCacheKeyHook;
	}): void;
	/** Compiles a `.pzl` module through `puzzle compile`; other ids pass through. */
	transform(
		code: string,
		id: string
	): Promise<{ code: string; map: null } | null>;
}

/**
 * Create the plugin. Add it to `plugins` in `vitest.config.js`:
 *
 * ```js
 * import { defineConfig } from 'vitest/config';
 * import { puzzle } from '@magic-spells/puzzle/vitest';
 *
 * export default defineConfig({
 *   plugins: [puzzle()],
 *   test: { environment: 'jsdom' },
 * });
 * ```
 */
export declare function puzzle(
	options?: PuzzleVitestOptions
): PuzzleVitePlugin;
