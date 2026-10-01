/**
 * Controllable IntersectionObserver for jsdom and similar DOMs (v1.58, D94).
 *
 * The runtime only needs observe/unobserve/disconnect plus target and
 * isIntersecting on delivered entries. The extra public fields make assertions
 * about D73 rootMargin sharing and cleanup straightforward.
 */

/** @returns {import('../../types/testing.js').FakeObserverController} */
export function installFakeObserver() {
	const descriptor =
		Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver') ?? null;
	/** @type {FakeIntersectionObserver[]} */
	const observers = [];
	let installed = true;

	class FakeIntersectionObserver {
		/** @param {IntersectionObserverCallback} callback @param {IntersectionObserverInit} [options] */
		constructor(callback, options = {}) {
			this.callback = callback;
			this.options = options;
			this.root = options.root ?? null;
			this.rootMargin = options.rootMargin ?? '0px';
			this.thresholds = Array.isArray(options.threshold)
				? [...options.threshold]
				: [options.threshold ?? 0];
			/** @type {Set<Element>} */
			this.observed = new Set();
			/** @type {Array<[Element]>} */
			this.observeCalls = [];
			/** @type {Array<[Element]>} */
			this.unobserveCalls = [];
			this.disconnectCalls = 0;
			this.disconnected = false;
			observers.push(this);
		}

		/** @param {Element} element */
		observe(element) {
			this.observeCalls.push([element]);
			this.observed.add(element);
			this.disconnected = false;
		}

		/** @param {Element} element */
		unobserve(element) {
			this.unobserveCalls.push([element]);
			this.observed.delete(element);
		}

		disconnect() {
			this.disconnectCalls++;
			this.observed.clear();
			this.disconnected = true;
		}

		/** @returns {IntersectionObserverEntry[]} */
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
		/** @param {Element} element @param {boolean} [isIntersecting] */
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
					// A deliberately partial IntersectionObserver (no scrollMargin).
					/** @type {IntersectionObserver} */ (/** @type {unknown} */ (observer))
				);
			}
		},
		triggerAll(isIntersecting = true) {
			for (const observer of observers) {
				const entries = [...observer.observed].map(/** @returns {IntersectionObserverEntry} */ (element) => ({
					target: element,
					isIntersecting,
					intersectionRatio: isIntersecting ? 1 : 0,
					time: 0,
					boundingClientRect: emptyRect(),
					intersectionRect: emptyRect(),
					rootBounds: null,
				}));
				// A deliberately partial IntersectionObserver (no scrollMargin).
				if (entries.length > 0) observer.callback(entries, /** @type {IntersectionObserver} */ (/** @type {unknown} */ (observer)));
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

/** @returns {DOMRectReadOnly} */
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
