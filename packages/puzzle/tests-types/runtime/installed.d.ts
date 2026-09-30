/**
 * Members the opt-in modules install onto Store.prototype and
 * PuzzleModel.prototype, declared OPTIONAL: core runtime code must not assume
 * them. Runtime check only — the drift guard declares them present instead
 * (tests-types/drift/installed.d.ts), matching the published augmentations an
 * app sees once it imports the subpath.
 */

import type { AdapterModelInstalled } from '../../client-runtime/datastore/adapter.js';

declare module '../../client-runtime/datastore/store.js' {
	interface Store {
		// ---- installed by /fixtures (D98) ----
		seed?(type: string, countOrShapes?: number | object[], overrides?: object): any[];
		resetFixtureSeed?(seed?: number): void;
		// ---- installed by the adapter capability; /fixtures swaps it for the mock ----
		_network?(
			url: RequestInfo | URL,
			init: RequestInit,
			context: { type: string; method: string; url: string }
		): Promise<Response>;
	}
}

// The record verbs the adapter capability installs on PuzzleModel.prototype.
declare module '../../client-runtime/model.js' {
	interface PuzzleModel extends Partial<Pick<AdapterModelInstalled, 'save' | 'delete'>> {}
}
