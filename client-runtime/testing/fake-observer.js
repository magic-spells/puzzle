/**
 * Controllable IntersectionObserver for jsdom and similar DOMs (v1.58, D94).
 *
 * The runtime only needs observe/unobserve/disconnect plus target and
 * isIntersecting on delivered entries. The extra public fields make assertions
 * about D73 rootMargin sharing and cleanup straightforward.
 */

export function installFakeObserver() {
	const descriptor =
		Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver') ?? null;
	const observers = [];
	let installed = true;

	class FakeIntersectionObserver {
		constructor(callback, options = {}) {
			this.callback = callback;
			this.options = options;
			this.root = options.root ?? null;
			this.rootMargin = options.rootMargin ?? '0px';
			this.thresholds = Array.isArray(options.threshold)
				? [...options.threshold]
				: [options.threshold ?? 0];
			this.observed = new Set();
			this.observeCalls = [];
			this.unobserveCalls = [];
			this.disconnectCalls = 0;
			this.disconnected = false;
			observers.push(this);
		}

		observe(element) {
			this.observeCalls.push([element]);
			this.observed.add(element);
			this.disconnected = false;
		}

		unobserve(element) {
			this.unobserveCalls.push([element]);
			this.observed.delete(element);
		}

		disconnect() {
			this.disconnectCalls++;
			this.observed.clear();
			this.disconnected = true;
		}

		takeRecords() {
			return [];
		}
	}

	Object.defineProperty(globalThis, 'IntersectionObserver', {
		configurable: true,
		writable: true,
		value: FakeIntersectionObserver,
	});

	return {
		observers,
		trigger(element, isIntersecting = true) {
			for (const observer of observers) {
				if (!observer.observed.has(element)) continue;
				observer.callback(
					[
						{
							target: element,
							isIntersecting,
							intersectionRatio: isIntersecting ? 1 : 0,
							time: 0,
							boundingClientRect: emptyRect(),
							intersectionRect: emptyRect(),
							rootBounds: null,
						},
					],
					observer
				);
			}
		},
		triggerAll(isIntersecting = true) {
			for (const observer of observers) {
				const entries = [...observer.observed].map((element) => ({
					target: element,
					isIntersecting,
					intersectionRatio: isIntersecting ? 1 : 0,
					time: 0,
					boundingClientRect: emptyRect(),
					intersectionRect: emptyRect(),
					rootBounds: null,
				}));
				if (entries.length > 0) observer.callback(entries, observer);
			}
		},
		uninstall() {
			if (!installed) return;
			installed = false;
			for (const observer of observers) observer.disconnect();
			if (descriptor) {
				Object.defineProperty(globalThis, 'IntersectionObserver', descriptor);
			} else {
				delete globalThis.IntersectionObserver;
			}
		},
	};
}

function emptyRect() {
	return {
		x: 0,
		y: 0,
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		width: 0,
		height: 0,
		toJSON() {
			return this;
		},
	};
}

export default installFakeObserver;
