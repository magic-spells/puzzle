// @vitest-environment jsdom
//
// link prefetch (D195): a link to a lazy() route loads that route's code on
// hover, touch or focus — and, with data-prefetch="visible", when it scrolls
// into view — so the click runs as a warm lazy route. router.prefetch(path)
// does the same by name. only code loads: no guard runs, no view is built.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazy } from '../client-runtime/index.js';
import { Router } from '../client-runtime/router/router.js';
import { hashRouter } from '../client-runtime/router/modes.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// let every queued microtask and the loader's promise chain run.
const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

class LazyView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'lazy' }, [text('LAZY')]);
	}
}

class LazyLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'lazy-layout' }, [slot()]);
	}
}

const routers = [];

/**
 * start a router over `routes` and return it with its mount element.
 * @param {any[]} routes
 * @param {object} [options] router options
 */
async function boot(routes, options = {}) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const context = { store: null, router: null, formatters: null };
	const router = new Router(routes, options);
	context.router = router;
	routers.push(router);
	await router.start(el, context);
	return { router, el };
}

/**
 * a link in the document, outside the app mount, like a nav bar would be.
 * @param {string} href
 * @param {Record<string, string>} [attrs]
 */
function link(href, attrs = {}) {
	const a = document.createElement('a');
	a.setAttribute('href', href);
	for (const [name, value] of Object.entries(attrs)) a.setAttribute(name, value);
	a.textContent = href;
	document.body.appendChild(a);
	return a;
}

/**
 * dispatch a pointer event. jsdom has no PointerEvent, so a MouseEvent carries
 * the pointerType the way a browser's would.
 * @param {Element} target
 * @param {'pointerover' | 'pointerout'} type
 * @param {{ pointerType?: string, relatedTarget?: Element | null }} [init]
 */
function pointer(target, type, { pointerType = 'mouse', relatedTarget = null } = {}) {
	const event = new MouseEvent(type, { bubbles: true, composed: true, relatedTarget });
	Object.defineProperty(event, 'pointerType', { value: pointerType });
	target.dispatchEvent(event);
}

// a lazy marker whose loader we can count.
const lazyRoute = () => {
	const loader = vi.fn(async () => ({ default: LazyView }));
	return { loader, marker: lazy(loader) };
};

beforeEach(() => {
	history.replaceState({}, '', '/');
});

afterEach(() => {
	for (const router of routers.splice(0)) router.stop();
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	delete navigator.connection;
});

describe('link prefetch on intent', () => {
	it('loads a hovered link after the pointer rests, and the click reuses the load', async () => {
		vi.useFakeTimers();
		const { loader, marker } = lazyRoute();
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);
		const a = link('/lazy');

		pointer(a, 'pointerover');
		// still within the hover delay: a pointer sweeping past fetches nothing.
		await flush();
		expect(loader).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60);
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
		await flush();
		a.click();
		await tick();
		await flush();
		expect(router.current.path).toBe('/lazy');
		expect(el.querySelector('.lazy')).not.toBeNull();
		// the navigation found the class already resolved.
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('cancels when the pointer leaves before the delay', async () => {
		vi.useFakeTimers();
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);
		const a = link('/lazy');

		pointer(a, 'pointerover');
		pointer(a, 'pointerout', { relatedTarget: document.body });
		vi.advanceTimersByTime(200);
		await flush();
		expect(loader).not.toHaveBeenCalled();
	});

	it("keeps the timer while the pointer moves onto the link's own children", async () => {
		vi.useFakeTimers();
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);
		const a = link('/lazy');
		const icon = document.createElement('span');
		a.appendChild(icon);

		pointer(a, 'pointerover');
		pointer(a, 'pointerout', { relatedTarget: icon });
		pointer(icon, 'pointerover');
		vi.advanceTimersByTime(60);
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('loads at once on touch and on keyboard focus', async () => {
		const touched = lazyRoute();
		const focused = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/touch', view: touched.marker },
			{ path: '/focus', view: focused.marker },
		]);

		pointer(link('/touch'), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(touched.loader).toHaveBeenCalledTimes(1);

		link('/focus').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		await flush();
		expect(focused.loader).toHaveBeenCalledTimes(1);
	});

	it('loads a lazy layout alongside the view', async () => {
		const layoutLoader = vi.fn(async () => ({ default: LazyLayout }));
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker, layout: lazy(layoutLoader) },
		]);

		pointer(link('/lazy'), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
		await flush();
		expect(layoutLoader).toHaveBeenCalledTimes(1);
	});

	it('ignores links a click would leave to the browser', async () => {
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);

		for (const a of [
			link('/lazy', { target: '_blank' }),
			link('/lazy', { download: '' }),
			link('https://example.com/lazy'),
			link('#lazy'),
		]) {
			pointer(a, 'pointerover', { pointerType: 'touch' });
		}
		await flush();
		expect(loader).not.toHaveBeenCalled();
	});

	it('skips everything under Save-Data and on 2g', async () => {
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);
		const a = link('/lazy');

		navigator.connection = { saveData: true };
		pointer(a, 'pointerover', { pointerType: 'touch' });
		pointer(document.body, 'pointerover', { pointerType: 'touch' });
		navigator.connection = { saveData: false, effectiveType: 'slow-2g' };
		pointer(a, 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).not.toHaveBeenCalled();

		pointer(document.body, 'pointerover', { pointerType: 'touch' });
		navigator.connection = { saveData: false, effectiveType: '4g' };
		pointer(a, 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('works through hash routing', async () => {
		const { loader, marker } = lazyRoute();
		await boot(
			[
				{ path: '/', view: HomeView },
				{ path: '/lazy', view: marker },
			],
			{ mode: hashRouter() }
		);

		pointer(link('#/lazy'), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
	});
});

describe('turning prefetch on and off', () => {
	it('data-prefetch="off" opts one link out', async () => {
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);

		pointer(link('/lazy', { 'data-prefetch': 'off' }), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).not.toHaveBeenCalled();
	});

	it('prefetch: false leaves only links that ask by name', async () => {
		const { loader, marker } = lazyRoute();
		await boot(
			[
				{ path: '/', view: HomeView },
				{ path: '/lazy', view: marker },
			],
			{ prefetch: false }
		);

		pointer(link('/lazy'), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).not.toHaveBeenCalled();
		pointer(document.body, 'pointerover', { pointerType: 'touch' });
		pointer(link('/lazy', { 'data-prefetch': '' }), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('warns about an unknown data-prefetch value and still prefetches on intent', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);

		pointer(link('/lazy', { 'data-prefetch': 'hover' }), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls.some(([message]) => String(message).includes('data-prefetch="hover"'))).toBe(true);
	});

	it('adds no listener for an eager-only route table, and stop() removes them', async () => {
		const add = vi.spyOn(document, 'addEventListener');
		const eager = await boot([{ path: '/', view: HomeView }]);
		expect(add.mock.calls.map(([type]) => type)).not.toContain('pointerover');

		eager.router.stop();
		const { loader, marker } = lazyRoute();
		const { router } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);
		expect(add.mock.calls.map(([type]) => type)).toEqual(
			expect.arrayContaining(['pointerover', 'pointerout', 'focusin'])
		);
		router.stop();
		pointer(link('/lazy'), 'pointerover', { pointerType: 'touch' });
		link('/lazy').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		await flush();
		expect(loader).not.toHaveBeenCalled();
	});

	it('rejects a prefetch option that is not a boolean', () => {
		expect(() => new Router([{ path: '/', view: HomeView }], { prefetch: 'hover' })).toThrow(
			/prefetch must be a boolean/
		);
	});
});

describe('guarded routes', () => {
	it('automatic prefetch skips them; asking by name loads without running the guard', async () => {
		const guard = vi.fn(() => true);
		const { loader, marker } = lazyRoute();
		const { router } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/admin', view: marker, guard },
		]);

		pointer(link('/admin'), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).not.toHaveBeenCalled();

		pointer(document.body, 'pointerover', { pointerType: 'touch' });
		pointer(link('/admin', { 'data-prefetch': 'intent' }), 'pointerover', { pointerType: 'touch' });
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);

		await expect(router.prefetch('/admin')).resolves.toBe(true);
		expect(guard).not.toHaveBeenCalled();
	});
});

describe('router.prefetch()', () => {
	it('resolves true once the code is loaded, false for no match', async () => {
		const { loader, marker } = lazyRoute();
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);

		await expect(router.prefetch('/lazy?tab=1#top')).resolves.toBe(true);
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
		// prefetch never navigates or builds the view.
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.lazy')).toBeNull();
		await expect(router.prefetch('/')).resolves.toBe(true);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(router.prefetch('/nowhere')).resolves.toBe(false);
		// a prefetch miss is not a navigation, so it says nothing.
		expect(warn).not.toHaveBeenCalled();
	});

	it('resolves false on a failed load and lets the next navigation retry', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const loader = vi
			.fn()
			.mockImplementationOnce(() => Promise.reject(new Error('offline')))
			.mockImplementation(async () => ({ default: LazyView }));
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: lazy(loader) },
		]);

		await expect(router.prefetch('/lazy')).resolves.toBe(false);
		await router.push('/lazy');
		await flush();
		expect(loader).toHaveBeenCalledTimes(2);
		expect(el.querySelector('.lazy')).not.toBeNull();
	});
});

describe('data-prefetch="visible"', () => {
	/** @type {{ callback: Function, targets: Set<Element> }[]} */
	let observers;

	beforeEach(() => {
		observers = [];
		// a minimal IntersectionObserver: records what it watches so the test can
		// report an intersection by hand.
		class FakeIO {
			constructor(callback) {
				this.callback = callback;
				this.targets = new Set();
				observers.push(this);
			}
			observe(el) {
				this.targets.add(el);
			}
			unobserve(el) {
				this.targets.delete(el);
			}
			disconnect() {
				this.targets.clear();
			}
		}
		vi.stubGlobal('IntersectionObserver', FakeIO);
	});

	/** report `el` as scrolled into view to whichever observer watches it. */
	const intersect = (el) => {
		for (const io of observers) {
			if (io.targets.has(el)) io.callback([{ target: el, isIntersecting: true }], io);
		}
	};
	const watching = (el) => observers.some((io) => io.targets.has(el));

	it('loads when a marked link scrolls into view, including links added later', async () => {
		const first = lazyRoute();
		const later = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/first', view: first.marker },
			{ path: '/later', view: later.marker },
		]);
		const a = link('/first', { 'data-prefetch': 'visible' });
		// a plain link is not watched for visibility.
		const plain = link('/later');
		await tick();
		expect(watching(a)).toBe(true);
		expect(watching(plain)).toBe(false);

		intersect(a);
		await flush();
		expect(first.loader).toHaveBeenCalledTimes(1);
		// once only.
		expect(watching(a)).toBe(false);

		const b = link('/later', { 'data-prefetch': 'visible' });
		await tick();
		intersect(b);
		await flush();
		expect(later.loader).toHaveBeenCalledTimes(1);
	});

	it('lets go of a marked link once it leaves the document', async () => {
		const { loader, marker } = lazyRoute();
		await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: marker },
		]);
		const a = link('/lazy', { 'data-prefetch': 'visible' });
		await tick();
		expect(watching(a)).toBe(true);

		a.remove();
		await tick();
		expect(watching(a)).toBe(false);
		await flush();
		expect(loader).not.toHaveBeenCalled();
	});

	it('loads a guarded route, since the link asked by name', async () => {
		const { loader, marker } = lazyRoute();
		await boot(
			[
				{ path: '/', view: HomeView },
				{ path: '/admin', view: marker, guard: () => true },
			],
			{ prefetch: false }
		);
		const a = link('/admin', { 'data-prefetch': 'visible' });
		await tick();
		intersect(a);
		await flush();
		expect(loader).toHaveBeenCalledTimes(1);
	});
});
