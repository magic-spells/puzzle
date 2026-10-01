/**
 * The one member every capability carries — what the framework calls to wire
 * the sync runtime in.
 * @typedef {{ install: () => void }} AdapterInstall
 */

/**
 * The frozen value `@magic-spells/puzzle/adapter` exports (and `adapter.defaults()`
 * returns): `install` wires the sync runtime; the bare export carries `defaults`,
 * a configured one carries its app-wide verbs as `d` instead. It IS the published
 * opaque `PuzzleAdapterCapability`, whose brand exists only in the types.
 * @typedef {import('../types/index.js').PuzzleAdapterCapability & AdapterInstall & { defaults?: (verbs?: object) => AdapterCapability, d?: Record<string, Function> }} AdapterCapability
 */

/**
 * The adapter's read state as it crosses a serialization boundary (D161): the
 * prerendered page's island, the HMR snapshot. `v` versions the envelope.
 * @typedef {{ v: number, complete: string[], loaded: string[], absent: string[] }} ReadStateEnvelope
 */

/**
 * What the adapter module registers here. `store` may be a per-view store
 * handle as well as the raw Store; an incoming envelope is untrusted, so every
 * field of it is optional.
 * @typedef {{
 *   serialize: (store: import('./datastore/store.js').Store) => ReadStateEnvelope,
 *   hydrate: (store: import('./datastore/store.js').Store, envelope: Partial<ReadStateEnvelope> | null | undefined) => void,
 * }} ReadStateCodec
 */

/** @type {WeakSet<object>} */
const adapterCapabilities = new WeakSet();

/**
 * Create the opaque value exported by the opt-in adapter subpath.
 * @param {{ install: () => void, defaults?: (verbs?: object) => AdapterCapability, d?: Record<string, Function> }} value
 * @returns {AdapterCapability} the same value, frozen (the brand is type-only)
 */
export function createAdapterCapability(value) {
	adapterCapabilities.add(Object.freeze(value));
	return /** @type {AdapterCapability} */ (value);
}

/**
 * Whether a value is the adapter capability produced by the adapter subpath.
 * @param {unknown} value
 * @returns {value is AdapterCapability}
 */
export function isAdapterCapability(value) {
	return adapterCapabilities.has(/** @type {object} */ (value));
}

/**
 * Whether a capability carries app-wide adapter defaults — i.e. it came from
 * `adapter.defaults(...)` rather than being the bare export. The bare capability
 * is the only one that still offers `defaults()`; a configured one closes over
 * its verbs instead, so the distinction is readable without importing the
 * adapter module (the static build asks this question from ssg/, which must not
 * drag the sync runtime into its graph to answer it).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isConfiguredAdapter(value) {
	return isAdapterCapability(value) && value.defaults === undefined;
}

/**
 * Validate and install the adapter capability without importing its module.
 * @param {unknown} value
 * @param {string} [label]
 */
export function installAdapterCapability(value, label = 'adapter') {
	if (!value) return;
	if (!isAdapterCapability(value)) {
		throw new TypeError(
			`[puzzle] ${label} must be the adapter capability imported from '@magic-spells/puzzle/adapter'`
		);
	}
	value.install();
}

// ---- read-state relay (D161) -------------------------------------------------
//
// The prerenderer, the static kernel and the dev HMR snapshot all need the
// adapter's read state (collection-complete types + known-absent identities),
// but none of them may IMPORT the adapter module: a no-adapter app would then
// ship the whole sync runtime in every static page (D157). The adapter module
// registers its codec here when it is in the graph at all; without it these are
// a null envelope and a no-op, which is exactly "behave as today".

/** @type {ReadStateCodec | null} */
let readStateCodec = null;

/**
 * Called once by the adapter module when it loads.
 * @param {ReadStateCodec} codec
 */
export function registerReadState(codec) {
	readStateCodec = codec;
}

/**
 * The store's serialized read state, or null when no adapter is present.
 * @param {import('./datastore/store.js').Store} store
 * @returns {ReadStateEnvelope | null}
 */
export function serializeReadState(store) {
	return readStateCodec ? readStateCodec.serialize(store) : null;
}

/**
 * Adopt a serialized envelope — no-op without the adapter module.
 * @param {import('./datastore/store.js').Store} store
 * @param {Partial<ReadStateEnvelope> | null | undefined} envelope
 */
export function hydrateReadState(store, envelope) {
	if (readStateCodec) readStateCodec.hydrate(store, envelope);
}

/**
 * Whether an envelope carries anything worth transferring. An empty one is
 * omitted from the wire so an adapter-less page stays byte-identical.
 * @param {Partial<ReadStateEnvelope> | null | undefined} envelope
 * @returns {boolean}
 */
export function hasReadState(envelope) {
	return Boolean(
		envelope && (envelope.complete?.length || envelope.loaded?.length || envelope.absent?.length)
	);
}
