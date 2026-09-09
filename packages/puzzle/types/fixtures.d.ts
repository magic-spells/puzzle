/**
 * Public declarations for @magic-spells/puzzle/fixtures (D98).
 *
 * The module attaches deterministic fixtures and the adapter mock to the core
 * classes at runtime; the core Store declares neither. Importing this subpath is
 * therefore what makes `store.seed()` and `store.resetFixtureSeed()` type-check —
 * the augmentation below is deliberately scoped to modules that import it, so a
 * production file calling `store.seed()` without installing fixtures is a type
 * error rather than a runtime one.
 */

import type { AdapterMock, PuzzleApp } from './index.js';

export type { AdapterMock, AdapterMockRequest, AdapterMockResult } from './index.js';

/** The default seed used when `installFixtures()` is given no `seed`. */
export declare const DEFAULT_FIXTURE_SEED: number;

/** The fixtures file's default export — `app/fixtures.js` in a `--fixtures` build. */
export interface FixturesConfig {
	/**
	 * Base seed for fixture generation and the mock's latency/failure rolls.
	 * Omit for the fixed default; the same config always generates the same data.
	 */
	seed?: number;
	/**
	 * Type → mock config, merged OVER the model's own `static adapter.mock` per
	 * key (this wins). A type with no `adapter.mock` at all is still mocked when
	 * it appears here.
	 */
	mock?: Record<string, AdapterMock>;
	/**
	 * Run on every `PuzzleApp.mount()` at `beforeMount` timing: after the app's
	 * own `beforeMount`, before navigation #0 — so records seeded here are visible
	 * to the first `data()`. Awaited.
	 */
	setup?: (this: PuzzleApp, app: PuzzleApp) => void | Promise<void>;
}

/**
 * Attach fixtures + the adapter mock to `Store` and `PuzzleApp`. Calling it again
 * without uninstalling replaces the active config. Returns the `uninstall`
 * function, which is idempotent and restores the core exactly (including deleting
 * the two Store methods this module added).
 */
export declare function installFixtures(config?: FixturesConfig): () => void;

/** Detach the module. Safe to call when not installed, and safe to call twice. */
export declare function uninstall(): void;

declare module './index.js' {
	interface Store {
		/**
		 * Populate the store with schema-generated records (v1.57, D95): a count, or
		 * explicit partial shapes whose gaps are generated. `overrides` are fixed on
		 * every record (an explicit shape wins). Records go through the normal
		 * `createRecord` path — defaults, validation and pk assignment included.
		 *
		 * Available only while `installFixtures()` is installed.
		 */
		seed(
			type: string,
			countOrShapes?: number | Record<string, any>[],
			overrides?: Record<string, any>
		): any[];
		/**
		 * Restart fixture generation from the seed — replays the same sequence.
		 * Pass a seed to switch to another fixed one.
		 *
		 * Available only while `installFixtures()` is installed.
		 */
		resetFixtureSeed(seed?: number): void;
	}
}
