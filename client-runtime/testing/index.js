/**
 * App-author test utilities for Puzzle (v1.58, D94).
 *
 * Direct-view tests get a complete three-service ctx without booting a router.
 * Navigation tests use PuzzleApp's real memory-mode router, preserving the
 * guard → load → atomic-commit pipeline while keeping the host URL untouched.
 */

import { PuzzleApp } from '../app.js';
import { Store } from '../datastore/store.js';
import { makeFormatterRegistry } from '../formatters.js';
import {
	ensureTracking,
	registerRouter,
	registerStore,
	settled,
	trackWork,
} from './settled.js';

export { settled } from './settled.js';
export { installFakeAnimate } from './fake-waapi.js';
export { installFakeObserver } from './fake-observer.js';
// Convenience re-export of the detachable fixtures module (D98) — same
// install/uninstall shape as the two fakes above, so a test can reach fixtures,
// the mock adapter and the DOM fakes through one import. The module itself lives
// at @magic-spells/puzzle/fixtures, which is what a --fixtures build imports.
export { installFixtures } from '../fixtures/index.js';

/**
 * Mount one PuzzleView subclass into a detached container and return a
 * query/action handle. Passing `route` (or `preloaded: true`) follows the
 * router-shaped preload → atomic mount path so the first data() sees the route.
 */
export async function mountView(ViewClass, options = {}) {
	requireDocument('mountView');
	ensureTracking();

	const container = document.createElement('div');
	const context = makeContext(options);
	const instance = new ViewClass(context);
	const unregisterStore = registerStore(context.store);
	const unregisterRouter = registerRouter(context.router);
	const {
		params = {},
		props = {},
		children = [],
		ref = null,
		route,
		preloaded = false,
	} = options;

	try {
		if (preloaded || route !== undefined) {
			await instance.preload({ params, props, route });
			await instance.mount(container, { children, ref, preloaded: true });
		} else {
			await instance.mount(container, { params, props, children, ref });
		}
		await settled();
	} catch (error) {
		instance.destroy();
		unregisterRouter();
		unregisterStore();
		throw error;
	}

	return makeViewHandle(instance, container, context, {
		unregisterRouter,
		unregisterStore,
	});
}

/**
 * Boot a real PuzzleApp in routerMode:'memory' against a detached target.
 * `target` and `routerMode` from config are deliberately overridden; every
 * other PuzzleApp option, including routerInitialPath, is passed through.
 */
export async function createTestApp(config = {}) {
	requireDocument('createTestApp');
	ensureTracking();

	const container = document.createElement('div');
	const app = new PuzzleApp({
		...config,
		target: container,
		routerMode: 'memory',
	});
	const mount = trackWork(app.mount());
	let store = null;
	let router = null;
	let unregisterStore = () => {};
	let unregisterRouter = () => {};

	try {
		// PuzzleApp wires these synchronously before its first await. Keeping the
		// reads inside the try also observes a mount that rejects before wiring
		// (invalid lifecycle config) instead of leaking its rejected promise.
		store = app.store;
		router = app.router;
		unregisterStore = registerStore(store);
		unregisterRouter = registerRouter(router);
		await mount;
		await settled();
	} catch (error) {
		await Promise.allSettled([mount]);
		app.unmount();
		unregisterRouter();
		unregisterStore();
		throw error;
	}

	return makeAppHandle(app, container, store, router, {
		unregisterRouter,
		unregisterStore,
	});
}

function makeContext(options) {
	const supplied = options.ctx ?? {};
	const store = options.store ?? supplied.store ?? new Store(options.models ?? {});
	const router =
		options.router ?? supplied.router ?? makeInertRouter(options.route ?? null);
	const formatters =
		supplied.formatters ??
		makeFormatterRegistry(options.formatters ?? {}, (path) => router.url(path));
	return { store, router, formatters };
}

function makeInertRouter(current) {
	return {
		current,
		push: async () => {},
		replace: async () => {},
		go: async () => {},
		back: async () => {},
		forward: async () => {},
		url: (path) => path,
		setMorphHandler: () => {},
	};
}

function makeViewHandle(instance, container, ctx, cleanup) {
	let destroyed = false;
	const handle = {
		instance,
		container,
		ctx,
		store: ctx.store,
		router: ctx.router,
		get element() {
			return instance.element;
		},
		find(selector) {
			return findWithin(instance.element, selector);
		},
		findAll(selector) {
			return findAllWithin(instance.element, selector);
		},
		async click(target) {
			dispatchClick(resolveTarget(handle, target));
			await settled();
			return handle;
		},
		async setProps(props) {
			instance.applyParentUpdate({ props });
			await settled();
			return handle;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			instance.destroy();
			cleanup.unregisterRouter();
			cleanup.unregisterStore();
		},
	};
	return handle;
}

function makeAppHandle(app, container, store, router, cleanup) {
	let destroyed = false;
	const handle = {
		app,
		container,
		element: container,
		store,
		router,
		get ctx() {
			return app.ctx;
		},
		find(selector) {
			return container.querySelector(selector);
		},
		findAll(selector) {
			return [...container.querySelectorAll(selector)];
		},
		async click(target) {
			dispatchClick(resolveTarget(handle, target));
			await settled();
			return handle;
		},
		async visit(path) {
			await router.push(path);
			await settled();
			return handle;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			app.unmount();
			cleanup.unregisterRouter();
			cleanup.unregisterStore();
		},
	};
	return handle;
}

function findWithin(root, selector) {
	return root?.nodeType === 1 ? root.querySelector(selector) : null;
}

function findAllWithin(root, selector) {
	return root?.nodeType === 1 ? [...root.querySelectorAll(selector)] : [];
}

function resolveTarget(handle, target) {
	if (typeof target !== 'string') return target;
	const element = handle.find(target);
	if (!element) {
		throw new Error(`[puzzle/testing] no element matches selector ${JSON.stringify(target)}`);
	}
	return element;
}

function dispatchClick(element) {
	if (!element || typeof element.dispatchEvent !== 'function') {
		throw new Error('[puzzle/testing] click() expects a selector or DOM Element');
	}
	// HTMLElement.click() performs native activation behavior too (checkbox
	// toggles/change, submit-button form submission). SVG and other Elements fall
	// back to a normal bubbling/cancelable MouseEvent. jsdom deliberately skips a
	// submit button's activation behavior when its form is detached (every D94
	// handle is detached), so reproduce that one default action after the click.
	const form =
		!element.isConnected && element.type === 'submit'
			? element.form ?? element.closest?.('form')
			: null;
	if (form) {
		const allowed = element.dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true })
		);
		if (allowed) {
			const Submit = typeof SubmitEvent === 'function' ? SubmitEvent : Event;
			form.dispatchEvent(
				new Submit('submit', { bubbles: true, cancelable: true, submitter: element })
			);
		}
	} else if (typeof element.click === 'function') {
		const checkable =
			!element.isConnected &&
			element.tagName === 'INPUT' &&
			(element.type === 'checkbox' || element.type === 'radio');
		const checked = checkable ? element.checked : null;
		element.click();
		// jsdom toggles a detached checkbox/radio for click(), but omits the native
		// input/change activation events. Puzzle apps commonly bind @change, so
		// complete the detached default action when the checked state moved.
		if (checkable && element.checked !== checked) {
			element.dispatchEvent(new Event('input', { bubbles: true }));
			element.dispatchEvent(new Event('change', { bubbles: true }));
		}
	} else {
		element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	}
}

function requireDocument(name) {
	if (typeof document === 'undefined') {
		throw new Error(`[puzzle/testing] ${name}() requires a DOM environment`);
	}
}
