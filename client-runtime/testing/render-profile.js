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

/**
 * Freeze the tally in place — the sink is detached moments later and `counts` is
 * never handed out anywhere else, so the report can BE it.
 */
function immutableReport(counts) {
	Object.freeze(counts.rendersByView);
	Object.freeze(counts.causes);
	return Object.freeze(counts);
}

export default measureRenders;

