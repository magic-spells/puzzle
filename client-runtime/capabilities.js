let adapterCapability;

/** Create the opaque value exported by the opt-in adapter subpath. */
export function createAdapterCapability(install) {
	adapterCapability = Object.freeze({ install });
	return adapterCapability;
}

/** Whether a value is the adapter capability produced by the adapter subpath. */
export function isAdapterCapability(value) {
	return value === adapterCapability;
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
