const adapterCapabilities = new WeakSet();

/** Create the opaque value exported by the opt-in adapter subpath. */
export function createAdapterCapability(value) {
	adapterCapabilities.add(Object.freeze(value));
	return value;
}

/** Whether a value is the adapter capability produced by the adapter subpath. */
export function isAdapterCapability(value) {
	return adapterCapabilities.has(value);
}

/**
 * Whether a capability carries app-wide adapter defaults — i.e. it came from
 * `adapter.defaults(...)` rather than being the bare export. The bare capability
 * is the only one that still offers `defaults()`; a configured one closes over
 * its verbs instead, so the distinction is readable without importing the
 * adapter module (the static build asks this question from ssg/, which must not
 * drag the sync runtime into its graph to answer it).
 */
export function isConfiguredAdapter(value) {
	return isAdapterCapability(value) && value.defaults === undefined;
}

/** Validate and install the adapter capability without importing its module. */
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

let readStateCodec = null;

/** Called once by the adapter module when it loads. */
export function registerReadState(codec) {
	readStateCodec = codec;
}

/** The store's serialized read state, or null when no adapter is present. */
export function serializeReadState(store) {
	return readStateCodec ? readStateCodec.serialize(store) : null;
}

/** Adopt a serialized envelope — no-op without the adapter module. */
export function hydrateReadState(store, envelope) {
	if (readStateCodec) readStateCodec.hydrate(store, envelope);
}

/**
 * Whether an envelope carries anything worth transferring. An empty one is
 * omitted from the wire so an adapter-less page stays byte-identical.
 */
export function hasReadState(envelope) {
	return Boolean(envelope && (envelope.complete?.length || envelope.absent?.length));
}
