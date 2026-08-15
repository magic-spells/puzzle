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
