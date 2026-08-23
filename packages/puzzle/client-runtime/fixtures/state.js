/**
 * Per-Store fixture state (D98) — internal to the `/fixtures` module.
 *
 * Before D98 these five fields lived on the Store itself, created in its
 * constructor behind build defines. They live here now because the core Store
 * must know nothing about fixtures: a WeakMap keyed by store instance gives the
 * same per-store isolation with zero footprint on an app that never installs
 * this module, and entries die with the stores that own them.
 *
 * ONE seed, TWO streams. Value generation and the mock's latency/failure rolls
 * must not share a stream, or adding a `store.seed()` call to a test would
 * silently change which requests fail. Both still derive from the one seed, so a
 * whole run replays from a single number.
 *
 * State is created LAZILY, on the first `seed()` call or the first mocked
 * request, using the seed that was active at that moment. A later
 * `installFixtures({ seed })` therefore cannot retroactively re-seed a store that
 * has already generated something — which is what makes a sequence reproducible.
 */

import { DEFAULT_FIXTURE_SEED, MOCK_STREAM_OFFSET, mulberry32 } from './generator.js';

let stateByStore = new WeakMap();
let baseSeed = DEFAULT_FIXTURE_SEED;

/**
 * Set the seed newly created store states will use. Called by installFixtures
 * with the fixtures config's `seed`; a non-finite value falls back to the fixed
 * default, so an identical config always generates identical fixtures.
 */
export function setBaseSeed(seed) {
	baseSeed = Number.isFinite(seed) ? seed : DEFAULT_FIXTURE_SEED;
}

/** Drop every store's state — called by uninstall() so install/uninstall cycles are hermetic. */
export function clearStates() {
	stateByStore = new WeakMap();
	baseSeed = DEFAULT_FIXTURE_SEED;
}

/**
 * The fixture state for `store`, created on first use.
 *
 * @returns {{ seed: number, fixtureRand: Function, mockRand: Function,
 *   fixtureIndex: number, mockCollections: Map|null, mockIdN: number }}
 */
export function stateFor(store) {
	let state = stateByStore.get(store);
	if (state) return state;
	state = {
		seed: baseSeed,
		fixtureRand: mulberry32(baseSeed),
		mockRand: mulberry32(baseSeed ^ MOCK_STREAM_OFFSET),
		fixtureIndex: 0, // monotonic across seed() calls — keeps fixtures distinct
		mockCollections: null, // type → Map(pk → object); built on first mock hit
		mockIdN: 0, // server-assigned-id counter for mock POSTs
	};
	stateByStore.set(store, state);
	return state;
}

/**
 * Restart both streams and the record counter from `state.seed`, optionally
 * switching to another fixed seed first. Does not touch already-created records
 * or the mock's live collections.
 */
export function reseed(state, seed) {
	if (Number.isFinite(seed)) state.seed = seed;
	state.fixtureRand = mulberry32(state.seed);
	state.mockRand = mulberry32(state.seed ^ MOCK_STREAM_OFFSET);
	state.fixtureIndex = 0;
}
