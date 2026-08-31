// @vitest-environment jsdom
//
// A routed view or layout CONSTRUCTOR throw is a pre-commit navigation failure,
// handled exactly like a lazy-loader rejection: reported through onError with
// phase 'navigation', URL/current/DOM untouched, and — the actual bug — the
// pending-navigation latch released so a later push() to the same path runs a
// fresh navigation instead of replaying the rejected promise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { setErrorConfig } from '../client-runtime/errors.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [slot()]);
	}
}

/** A leaf view whose FIELD INITIALIZER throws on the first construction only. */
function makeLeafThrowingOnce(name, error) {
	let attempts = 0;
	return class extends PuzzleView {
		guard = (() => {
			if (++attempts === 1) throw error;
			return true;
		})();
		render() {
			return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
		}
	};
}

/** A shell view that hosts its child route at a <Slot/>, with a created() spy. */
function makeShell(name, onCreated) {
	return class extends PuzzleView {
		created() {
			onCreated?.();
		}
		render() {
			return h('puzzle-view', { class: name }, [h('section', {}, [slot()])]);
		}
	};
}

const routers = [];

async function boot(routes, { onError } = {}) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const context = { store: null, router: null, formatters: null };
	if (onError) setErrorConfig(context, onError, null);
	const router = new Router(routes);
	context.router = router;
	routers.push({ router, context });
	await router.start(el, context);
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
});

afterEach(() => {
	for (const { router, context } of routers.splice(0)) {
		router.stop();
		setErrorConfig(context, null, null);
	}
	document.body.replaceChildren();
});

describe('routed constructor throws', () => {
	it('reports a view constructor throw and leaves the same path retryable', async () => {
		const failure = new Error('field initializer blew up');
		const errors = [];
		const Boom = makeLeafThrowingOnce('boom', failure);
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/boom', view: Boom, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		const first = router.push('/boom');
		await expect(first).resolves.toBeUndefined();

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/');
		expect(location.pathname).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.boom')).toBeNull();

		// The latch is released: this is a NEW navigation, not the first one's promise.
		const second = router.push('/boom');
		expect(second).not.toBe(first);
		await second;

		expect(router.current.path).toBe('/boom');
		expect(el.querySelector('.boom')).not.toBeNull();
		expect(errors).toHaveLength(1);
	});

	it('reports a layout constructor throw and leaves the same path retryable', async () => {
		const failure = new Error('layout field initializer blew up');
		const errors = [];
		let attempts = 0;
		class BoomLayout extends PuzzleView {
			guard = (() => {
				if (++attempts === 1) throw failure;
				return true;
			})();
			render() {
				return h('puzzle-view', { class: 'boom-layout' }, [slot()]);
			}
		}
		class LeafView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'leaf' }, [text('LEAF')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/boom', view: LeafView, layout: BoomLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		const first = router.push('/boom');
		await expect(first).resolves.toBeUndefined();

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.boom-layout')).toBeNull();

		const second = router.push('/boom');
		expect(second).not.toBe(first);
		await second;

		expect(router.current.path).toBe('/boom');
		expect(el.querySelector('.boom-layout .leaf')).not.toBeNull();
	});

	it('never runs created() on the parent when a child constructor throws', async () => {
		const failure = new Error('child constructor blew up');
		const errors = [];
		const parentCreated = vi.fn();
		const Parent = makeShell('parent', parentCreated);
		const Child = makeLeafThrowingOnce('child', failure);
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{
					path: '/parent',
					view: Parent,
					layout: DefaultLayout,
					children: [{ path: 'child', view: Child }],
				},
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		const first = router.push('/parent/child');
		await expect(first).resolves.toBeUndefined();

		// The parent instance was constructed before the child threw; it is dropped
		// without created() ever running, so no destroyed() partner is owed either.
		expect(parentCreated).not.toHaveBeenCalled();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/');

		const second = router.push('/parent/child');
		expect(second).not.toBe(first);
		await second;

		expect(parentCreated).toHaveBeenCalledTimes(1);
		expect(el.querySelector('.parent .child')).not.toBeNull();
		expect(router.current.path).toBe('/parent/child');
	});
});
