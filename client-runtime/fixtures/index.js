/**
 * `@magic-spells/puzzle/fixtures` — deterministic fixtures + the adapter mock,
 * as a module that ATTACHES ITSELF to the core classes (D98).
 *
 * ## Why it is shaped this way
 *
 * Fixtures and the mock adapter are development and test affordances. Baking
 * them into `Store` (v1.57, D95) meant the core carried code no production app
 * runs, and keeping it out of production bundles then needed compiler-emitted
 * build defines threaded through the store constructor, `seed()`,
 * `resetFixtureSeed()` and `_fetch` (v1.59, D96) — four gated branches, two
 * "was compiled out" throws, and a core file that had to know this feature
 * exists. D98 inverts that: the core keeps exactly ONE seam, `Store._network`
 * (the single place an adapter request touches the network), and EVERYTHING
 * else lives here.
 *
 * `installFixtures()` patches the prototypes:
 *
 *   - `Store.prototype.seed` / `.resetFixtureSeed` — ADDED (they do not exist on
 *     an un-installed Store, which is why `uninstall()` deletes rather than
 *     restores them).
 *   - `Store.prototype._network` — REPLACED with a mock interception that falls
 *     through to the captured original for any un-mocked type.
 *   - `PuzzleApp.prototype.mount` — WRAPPED so the fixtures config's `setup`
 *     hook runs at `beforeMount` timing, i.e. after the app's own `beforeMount`
 *     and before navigation #0, so seeded records are visible to the first
 *     `data()`.
 *
 * Prototype patching (rather than, say, a Store subclass) is what lets an app
 * opt in without changing a single line of its own code: the compiler's
 * `--fixtures` flag generates a tiny wiring entry that imports this module and
 * calls `installFixtures(config)` with the default export of the app's
 * `app/fixtures.js`, before the app module boots. Tests import it directly:
 *
 *     import { installFixtures } from '@magic-spells/puzzle/fixtures';
 *     beforeEach(() => installFixtures({ seed: 42 }));
 *     afterEach(uninstall);
 *
 * A build made WITHOUT `--fixtures` never imports this module, so nothing here
 * — generator, mock, PRNG — reaches the bundle. There is no define to fold and
 * no dead branch to trip over; "not imported" is the whole tree-shake.
 *
 * ## Per-store state
 *
 * The five pieces of fixture bookkeeping that used to be Store fields live in a
 * WeakMap in state.js. The Store owns none of it.
 *
 * @see constellation/decision — D98 (fixtures as a detachable module)
 */

import { PuzzleApp } from '../app.js';
import { Store } from '../datastore/store.js';
import { DEFAULT_FIXTURE_SEED, generateFixture } from './generator.js';
import { mockFetch } from './mock.js';
import { clearStates, reseed, setBaseSeed, stateFor } from './state.js';

export { DEFAULT_FIXTURE_SEED } from './generator.js';

/**
 * The config passed to the most recent `installFixtures()`, or null when the
 * module is not installed. Read live (never captured) so a re-install swaps
 * behavior for already-constructed stores and apps.
 */
let activeConfig = null;

/** True between the first install and the matching uninstall. */
let installed = false;

/**
 * The prototype members as they were BEFORE the first install. Captured only on
 * the uninstalled → installed transition, so a second install (which merely
 * replaces activeConfig) can never capture our own patched functions and leave
 * uninstall restoring them forever.
 */
let originalNetwork = null;
let originalMount = null;

/**
 * Marks the composed `beforeMount` this module installed on a given app, so a
 * mount → unmount → re-mount cycle composes once instead of stacking a new
 * wrapper per mount.
 */
const COMPOSED_BEFORE_MOUNT = Symbol('puzzleFixturesBeforeMount');

/**
 * Brands a composed hook. The per-instance symbol above cannot see the case where
 * two apps SHARE one config object: the second app would treat the first's
 * composed hook as user code and wrap it again, running `setup` twice. Reading
 * the brand off the hook itself covers that too.
 */
const FIXTURES_COMPOSED = Symbol('puzzleFixturesComposed');

/**
 * Install the fixtures module.
 *
 * @param {object} [config] the fixtures file's default export:
 *   - `seed`     {number}   base seed for generation and the mock's rolls
 *   - `mock`     {object}   type → mock config, merged OVER the model's own
 *                           `adapter.mock` per key (the file wins). A type with
 *                           no `adapter.mock` at all is still mocked when it has
 *                           an entry here.
 *   - `setup`    {Function} `setup(app)` run at beforeMount timing on every
 *                           `PuzzleApp.mount()` — where an app seeds its store.
 * @returns {Function} `uninstall()` — idempotent; restores the core exactly.
 */
export function installFixtures(config = {}) {
	if (config === null || typeof config !== 'object' || Array.isArray(config)) {
		throw new TypeError(
			'[puzzle] installFixtures(config) expects a plain object ' +
				'({ seed, mock, setup }) or no argument'
		);
	}
	if (config.setup != null && typeof config.setup !== 'function') {
		throw new TypeError('[puzzle] installFixtures(): config.setup must be a function when set');
	}
	if (config.mock != null && (typeof config.mock !== 'object' || Array.isArray(config.mock))) {
		throw new TypeError('[puzzle] installFixtures(): config.mock must be an object of type → mock');
	}

	if (!installed) {
		originalNetwork = Store.prototype._network;
		originalMount = PuzzleApp.prototype.mount;
		Store.prototype.seed = seed;
		Store.prototype.resetFixtureSeed = resetFixtureSeed;
		Store.prototype._network = mockNetwork;
		PuzzleApp.prototype.mount = fixturesMount;
		installed = true;
	}

	activeConfig = config;
	setBaseSeed(config.seed);
	return uninstall;
}

/**
 * Detach the module: restore `_network` and `mount`, DELETE the two methods that
 * did not exist before (leaving them behind would make `typeof store.seed` lie
 * about whether fixtures are available), and forget every store's state. Safe to
 * call when not installed, and safe to call twice.
 */
export function uninstall() {
	if (!installed) {
		activeConfig = null;
		return;
	}
	Store.prototype._network = originalNetwork;
	PuzzleApp.prototype.mount = originalMount;
	delete Store.prototype.seed;
	delete Store.prototype.resetFixtureSeed;
	originalNetwork = null;
	originalMount = null;
	installed = false;
	activeConfig = null;
	clearStates();
}

// ---- Store.prototype.seed / .resetFixtureSeed ------------------------------

/**
 * Populate the store with schema-generated records (v1.57, D95):
 *
 *   store.seed('todo', 5)                       // 5 generated records
 *   store.seed('todo', 5, { done: false })      // generated, fixed overrides
 *   store.seed('todo', [{ title: 'a' }, {}])    // explicit shapes, gaps generated
 *
 * Every record goes through the NORMAL createRecord path, so schema defaults,
 * §20 validation and pk assignment behave exactly as in production — a fixture
 * that could not exist at runtime is worthless. Generation is deterministic (see
 * generator.js); the one exception is an auto-generated primary key, which the
 * Store's existing `_genId` still assigns randomly. Records are created LOCAL and
 * unsynced, so a later save() POSTs, exactly like a hand-typed one.
 *
 * @this {Store}
 * @param {string} type
 * @param {number|object[]} [countOrShapes=1] how many, or explicit partials
 * @param {object} [overrides={}] fields fixed on every record (a shape wins)
 * @returns {PuzzleModel[]} the created records
 */
function seed(type, countOrShapes = 1, overrides = {}) {
	const shapes = Array.isArray(countOrShapes) ? countOrShapes : null;
	if (!shapes && !(Number.isInteger(countOrShapes) && countOrShapes >= 0)) {
		throw new Error(
			`[puzzle] seed('${type}') expects a record count or an array of record shapes`
		);
	}
	const state = stateFor(this);
	const list = shapes || new Array(countOrShapes).fill(null);
	return list.map((shape) => {
		const merged = { ...overrides, ...(shape || {}) };
		return this.createRecord(
			type,
			generateFixture(this, type, merged, state.fixtureIndex++, state.fixtureRand)
		);
	});
}

/**
 * Restart fixture generation from the seed — both PRNG streams and the record
 * counter — so a test can replay the exact same sequence. Pass a seed to switch
 * to a different (still fixed) one. Does not touch already-created records.
 *
 * @this {Store}
 */
function resetFixtureSeed(seedValue) {
	reseed(stateFor(this), seedValue);
}

// ---- Store.prototype._network ---------------------------------------------

/**
 * The mock interception (D98). Runs in place of the core's one-line `_network`,
 * i.e. after `beforeRequest` and instead of `fetch`.
 *
 * Two sources of mock config, merged with the fixtures file winning per key: the
 * model's own `adapter.mock` (checked into the app, travels with the model) and
 * `config.mock[type]` (a test or a local fixtures file overriding, say, only
 * `failRate`). Either alone is enough to mock a type.
 *
 * @this {Store}
 */
function mockNetwork(url, init, context) {
	const modelMock = this.modelFor(context.type).adapter?.mock;
	const fileMock = activeConfig?.mock?.[context.type];
	if (modelMock || fileMock) {
		return mockFetch(this, context.type, { ...modelMock, ...fileMock }, url, init);
	}
	return originalNetwork.call(this, url, init, context);
}

// ---- PuzzleApp.prototype.mount --------------------------------------------

/**
 * Wrapped `mount()`. The fixtures config's `setup(app)` must run where a store
 * seed is actually useful: after the ctx services are wired and after the app's
 * OWN `beforeMount` (an app that logs in or loads config there should have
 * finished), but before navigation #0, so the first `data()` sees the records.
 * That is exactly `beforeMount` timing, so rather than duplicate mount()'s abort
 * and re-entrancy handling here, this composes into `config.beforeMount` and lets
 * the real hook machinery run it.
 *
 * Composition is idempotent per app instance: the composed function is stamped on
 * the instance, so a mount → unmount → re-mount cycle reuses it instead of
 * nesting a new wrapper each time. `setup` is read at CALL time, so uninstalling
 * (or re-installing with a different config) is respected even by an app whose
 * config was already composed.
 *
 * @this {PuzzleApp}
 */
function fixturesMount() {
	const existing = this.config?.beforeMount;
	// "Already ours" — either the hook we stamped on THIS instance, or (shared
	// config object) one stamped for another app. Anything else, including no hook
	// at all, still needs composing.
	const alreadyComposed =
		existing != null &&
		(existing === this[COMPOSED_BEFORE_MOUNT] || existing[FIXTURES_COMPOSED] === true);
	if (this.config && !alreadyComposed) {
		const composed = async function composedBeforeMount(app) {
			if (existing != null) await existing.call(this, app);
			const setup = activeConfig?.setup;
			if (typeof setup === 'function') await setup.call(this, app);
		};
		composed[FIXTURES_COMPOSED] = true;
		this[COMPOSED_BEFORE_MOUNT] = composed;
		this.config.beforeMount = composed;
	}
	return originalMount.call(this);
}
