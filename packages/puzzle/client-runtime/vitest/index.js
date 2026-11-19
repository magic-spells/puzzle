/**
 * `@magic-spells/puzzle/vitest` — the Vite plugin that lets an app's own Vitest
 * suite import `.pzl` files (D193).
 *
 * Vitest runs on Vite, and Vite cannot read a `.pzl` file: the real compiler is
 * the Go binary, which `puzzle build` drives through esbuild. So this plugin
 * hands each `.pzl` module Vite loads to the hidden `puzzle compile <file>`
 * command and serves the JavaScript module it prints. It also mirrors the
 * build's always-on `@/` app alias (SPEC §40), so `@/components/Card.pzl`
 * resolves in a test exactly as it does in the app.
 *
 * Node-only tooling: it runs inside Vitest's process, never in a browser
 * bundle, and nothing in the runtime imports it.
 *
 *   // vitest.config.js
 *   import { defineConfig } from 'vitest/config';
 *   import { puzzle } from '@magic-spells/puzzle/vitest';
 *
 *   export default defineConfig({
 *     plugins: [puzzle()],
 *     test: { environment: 'jsdom' },
 *   });
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

// the bin shim this package ships (bin/puzzle.js). it finds the platform binary
// and forwards argv and exit code, so spawning it through node behaves exactly
// like the `puzzle` command in the app's own npm scripts.
const SHIM = fileURLToPath(
	new URL('../../bin/puzzle.js', import.meta.url)
);

// compiled modules are small, but a view inlining several large {#svg} assets
// can pass node's 1 MB default output cap
const MAX_OUTPUT = 64 * 1024 * 1024;

// the framework version this plugin ships with. the installed binary is pinned
// to the same version, so it names the compiler that produced a cached module.
const VERSION = JSON.parse(
	fs.readFileSync(
		fileURLToPath(new URL('../../package.json', import.meta.url)),
		'utf8'
	)
).version;

/**
 * vitest's cache-key hook: given a module, return extra text for its cache
 * key, `false` to never cache it, or undefined to leave it alone.
 *
 * @typedef {(generator: (module: { id: string, sourceCode: string }) => string | false | undefined) => void} CacheKeyHook
 */

/**
 * @typedef {object} PuzzleVitestOptions
 * @property {string} [bin] path to a `puzzle` executable to run instead of the
 *   installed one (for example a compiler built from source). The
 *   `PUZZLE_BIN` environment variable does the same; this option wins.
 */

/**
 * Create the Vite plugin. Add it to `plugins` in `vitest.config.js`.
 *
 * @param {PuzzleVitestOptions} [options]
 */
export function puzzle(options = {}) {
	/**
	 * run `puzzle compile <file>` and resolve with what it prints. a compile
	 * error rejects with the positioned `file:line:col: message` text, which
	 * vitest shows as the failing import.
	 *
	 * @param {string} file absolute path of the .pzl file
	 * @returns {Promise<{ code: string, warnings: string }>}
	 */
	function compile(file) {
		// an explicit executable runs directly; otherwise go through the shim
		const bin = options.bin ?? process.env.PUZZLE_BIN;
		const command = bin ?? process.execPath;
		const args = bin ? ['compile', file] : [SHIM, 'compile', file];
		return new Promise((resolve, reject) => {
			execFile(
				command,
				args,
				{ maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
				(error, stdout, stderr) => {
					if (error) {
						// stderr carries the compiler's diagnostic; fall back to the spawn
						// error itself (a missing binary, for instance)
						reject(new Error(String(stderr).trim() || error.message));
						return;
					}
					resolve({
						code: String(stdout),
						warnings: String(stderr).trim(),
					});
				}
			);
		});
	}

	return {
		name: 'puzzle',
		// run before vite's own transforms, which would try to parse the raw .pzl
		enforce: /** @type {'pre'} */ ('pre'),

		/**
		 * mirror the build's `@/` alias: `@/x` means `<project root>/app/x`.
		 *
		 * @param {{ root?: string }} config the user's vite/vitest config
		 */
		config(config) {
			const root = path.resolve(config.root ?? process.cwd());
			return {
				resolve: {
					alias: [
						{
							find: /^@\//,
							replacement: path.join(root, 'app') + '/',
						},
					],
				},
			};
		},

		/**
		 * keep vitest's on-disk module cache honest. it keys a module on its
		 * source text, but a compiled .pzl also depends on the compiler that
		 * made it and on any {#svg} file it inlines. so the key names the
		 * framework version, and a .pzl that inlines svg, or any .pzl compiled by
		 * a custom binary, is not cached at all. older vitest versions without
		 * the hook simply skip this.
		 *
		 * @param {{ defineCacheKeyGenerator?: CacheKeyHook, experimental_defineCacheKeyGenerator?: CacheKeyHook }} context
		 */
		configureVitest(context) {
			const define =
				context.defineCacheKeyGenerator ??
				context.experimental_defineCacheKeyGenerator;
			define?.(({ id, sourceCode }) => {
				if (!id.split('?')[0].endsWith('.pzl')) return undefined;
				if (options.bin ?? process.env.PUZZLE_BIN) return false;
				if (sourceCode.includes('{#svg')) return false;
				return `puzzle@${VERSION}`;
			});
		},

		/**
		 * compile .pzl modules; leave every other module to vite.
		 *
		 * @this {{ warn?: (message: string) => void }} vite's plugin context
		 * @param {string} _code the raw .pzl source vite read (the compiler reads
		 *   the file itself, so this is unused)
		 * @param {string} id the module id, possibly with a `?query`
		 */
		async transform(_code, id) {
			const file = id.split('?')[0];
			if (!file.endsWith('.pzl')) return null;
			const { code, warnings } = await compile(file);
			// codegen warnings are advisory; surface them without failing the test
			if (warnings) this.warn?.(warnings);
			return { code, map: /** @type {null} */ (null) };
		},
	};
}
