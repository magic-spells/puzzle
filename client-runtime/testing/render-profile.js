/**
 * Runner-neutral render assertions for @magic-spells/puzzle/testing (D121).
 */

import { devperfInstallSink } from '../devperf.js';
import { settled } from './settled.js';

/**
 * Measure framework render work caused by callback, including work drained by
 * settled(). The handle is intentionally not patched or inspected; accepting it
 * keeps the call site self-documenting and leaves room for view/app parity.
 */
export async function measureRenders(handle, callback) {
	if (typeof callback !== 'function') {
		throw new TypeError('[puzzle/testing] measureRenders() expects a callback');
	}
	void handle;

	const counts = {
		renders: 0,
		wastedRenders: 0,
		domMutations: 0,
		rendersByView: {},
		causes: {},
		maxRecursiveDepth: 0,
		storeNotifications: 0,
	};
	const detach = devperfInstallSink((event) => {
		if (event.type === 'render') {
			counts.renders++;
			if (event.wasted) counts.wastedRenders++;
			counts.domMutations += event.domMutations;
			increment(counts.rendersByView, event.viewName);
			for (const cause of event.causes) increment(counts.causes, cause);
			counts.maxRecursiveDepth = Math.max(counts.maxRecursiveDepth, event.depth);
		} else if (event.type === 'store-flush') {
			counts.storeNotifications += event.notified;
		} else if (event.type === 'loop') {
			counts.maxRecursiveDepth = Math.max(counts.maxRecursiveDepth, event.depth);
		}
	});

	try {
		await callback();
		await settled();
		return immutableReport(counts);
	} finally {
		detach();
	}
}

function increment(record, key) {
	record[key] = (record[key] ?? 0) + 1;
}

function immutableReport(counts) {
	return Object.freeze({
		renders: counts.renders,
		wastedRenders: counts.wastedRenders,
		domMutations: counts.domMutations,
		rendersByView: Object.freeze({ ...counts.rendersByView }),
		causes: Object.freeze({ ...counts.causes }),
		maxRecursiveDepth: counts.maxRecursiveDepth,
		storeNotifications: counts.storeNotifications,
	});
}

export default measureRenders;

