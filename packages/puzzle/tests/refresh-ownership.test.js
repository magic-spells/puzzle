// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, mountView, settled } from '../client-runtime/testing/index.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

adapter.install();

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((ok, fail) => {
		resolve = ok;
		reject = fail;
	});
	return { promise, resolve, reject };
};
const handles = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	vi.restoreAllMocks();
});

class ErrorView extends PuzzleView {
	render() {
		return h('section', { class: 'app-error' }, [text(this.props.error.message)]);
	}
}

async function refreshFixture({ errorView = true, binding = false, autoFetch = true } = {}) {
	const remote = deferred();
	const loadOne = vi.fn(() => remote.promise);
	class Post extends PuzzleModel {
		static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
		static adapter = { loadOne };
	}
	let child, host;
	const destroyed = vi.fn();
	class Child extends PuzzleView {
		created() {
			child = this;
			if (binding) this.setData({ id: 'initial' });
		}
		data() {
			const id = binding ? this.getData().id : this.props.id;
			if (id === 'old') {
				// Deliberately SYNCHRONOUS: D161 waits for the fault outside the store's
				// async tracking chain, allowing 'new' to commit before this load settles.
				this.ctx.store.findOne('post', 'old');
			}
			return { label: id };
		}
		destroyed() {
			destroyed();
		}
		render() {
			return h('div', { class: 'child' }, [
				...(binding
					? [h('input', { value: this.getData().id, '@input:bind': this.__bind(null, 'id', 'v') })]
					: []),
				h('p', {}, [text(this.getData().label)]),
			]);
		}
	}
	if (!autoFetch) {
		Child.prototype.data = async function () {
			const id = binding ? this.getData().id : this.props.id;
			if (id === 'old') await remote.promise;
			return { label: id };
		};
	}
	class Host extends PuzzleView {
		created() {
			host = this;
			this.setData({ id: 'initial', show: true });
		}
		render() {
			return h('main', {}, this.getData().show ? [h(Child, { id: this.getData().id })] : []);
		}
	}
	const onError = vi.fn();
	const app = await createTestApp({
		routes: [{ path: '/', view: Host }],
		models: autoFetch ? { post: Post } : {},
		...(autoFetch ? { adapter } : {}),
		...(errorView ? { errorView: ErrorView } : {}),
		onError,
	});
	handles.push(app);
	const refresh = vi.spyOn(child, 'refresh');
	const settle = autoFetch ? vi.spyOn(child, '_settleData') : null;
	const change = (id) => {
		if (binding) {
			const input = app.find('input');
			input.value = id;
			input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		} else {
			host.setData({ id });
			host.flushUpdates();
		}
		return refresh.mock.results.at(-1).value;
	};
	return { app, child, host, remote, loadOne, onError, destroyed, change, settle };
}

describe('AF-01 — stale refresh ownership', () => {
	it.each([true, false])('a stale auto-fetch rejection preserves the newer child (errorView=%s)', async (errorView) => {
		const f = await refreshFixture({ errorView });
		const old = f.change('old');
		const loop = f.settle.mock.results.at(-1).value;
		expect(f.loadOne).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'old');
		expect(f.change('new')).toBeUndefined();
		const element = f.child.element;
		expect(f.app.find('p').textContent).toBe('new');

		f.remote.reject(new Error('old load failed'));
		// Pin the adapter's rejection arm independently of refresh's outer guard.
		await expect(loop).resolves.toBeUndefined();
		await expect(old).resolves.toBeUndefined();
		await settled();

		expect(f.app.find('p').textContent).toBe('new');
		expect(f.app.find('.child')).toBe(element);
		expect(f.child.isDestroyed).toBe(false);
		expect(f.destroyed).not.toHaveBeenCalled();
		expect(f.onError).not.toHaveBeenCalled();
		expect(f.app.find('.app-error')).toBeNull();
		expect(f.app.store._heldKeys.get(f.child)).toBeUndefined();
		expect([...(f.app.store.keysBySubscriber.get(f.child) ?? [])]).toEqual([]);
	});

	it('discards a stale rejection from the binding-driven refresh entry point', async () => {
		const f = await refreshFixture({ binding: true });
		const old = f.change('old');
		expect(f.loadOne).toHaveBeenCalledOnce();
		expect(f.change('new')).toBeUndefined();
		expect(f.app.find('p').textContent).toBe('new');
		const element = f.child.element;

		f.remote.reject(new Error('old bound load failed'));
		await expect(old).resolves.toBeUndefined();
		await settled();

		expect(f.app.find('p').textContent).toBe('new');
		expect(f.app.find('input').value).toBe('new');
		expect(f.app.find('.child')).toBe(element);
		expect(f.child.isDestroyed).toBe(false);
		expect(f.onError).not.toHaveBeenCalled();
	});

	it.each([true, false])('ignores rejection after destruction (autoFetch=%s)', async (autoFetch) => {
		const f = await refreshFixture({ autoFetch });
		const old = f.change('old');
		f.host.setData({ show: false });
		f.host.flushUpdates();
		expect(f.child.isDestroyed).toBe(true);

		f.remote.reject(new Error('destroyed load failed'));
		await expect(old).resolves.toBeUndefined();
		await settled();

		expect(f.app.find('main').children).toHaveLength(0);
		expect(f.destroyed).toHaveBeenCalledOnce();
		expect(f.onError).not.toHaveBeenCalled();
		expect(f.app.store._heldKeys.get(f.child)).toBeUndefined();
	});

	it.each([true, false])('ignores rejection while leaving (autoFetch=%s)', async (autoFetch) => {
		const f = await refreshFixture({ autoFetch });
		const old = f.change('old');
		const element = f.child.element;
		await f.child.playOut();
		expect(f.child.isDestroyed).toBe(false);

		f.remote.reject(new Error('leaving load failed'));
		await expect(old).resolves.toBeUndefined();
		await settled();

		expect(f.app.find('.child')).toBe(element);
		expect(f.app.find('p').textContent).toBe('initial');
		expect(f.child.isDestroyed).toBe(false);
		expect(f.destroyed).not.toHaveBeenCalled();
		expect(f.onError).not.toHaveBeenCalled();
		expect(f.app.find('.app-error')).toBeNull();
		expect(f.app.store._heldKeys.get(f.child)).toBeUndefined();
	});

	it('also guards the refresh boundary when data() itself rejects without an adapter', async () => {
		const f = await refreshFixture({ autoFetch: false });
		const old = f.change('old');
		const newer = f.change('new');
		// Here the store serializes 'new' behind 'old', but the new token already owns
		// the view. The old rejection must not reach the parent's failure wrapper.
		f.remote.reject(new Error('superseded data failed'));
		await expect(old).resolves.toBeUndefined();
		await newer;
		await settled();

		expect(f.app.find('p').textContent).toBe('new');
		expect(f.child.isDestroyed).toBe(false);
		expect(f.onError).not.toHaveBeenCalled();
	});

	it.each([false, true])('a current-run rejection still reports and replaces the child (binding=%s)', async (binding) => {
		const f = await refreshFixture({ binding });
		const current = f.change('old');
		f.remote.reject(new Error('current load failed'));
		await expect(current).rejects.toThrow('current load failed');
		await settled();

		expect(f.onError).toHaveBeenCalledOnce();
		const [error, info] = f.onError.mock.calls[0];
		expect(error.message).toContain('current load failed');
		expect(info).toEqual({ phase: binding ? 'bind' : 'refresh', view: f.child, route: null });
		expect(f.child.isDestroyed).toBe(true);
		expect(f.destroyed).toHaveBeenCalledOnce();
		expect(f.app.find('.app-error').textContent).toBe(error.message);
		expect(f.app.find('.child')).toBeNull();
	});

	it('a directly awaited current refresh still rejects without entering the background funnel', async () => {
		const f = await refreshFixture();
		const current = f.child.refresh({ props: { id: 'old' } });
		f.remote.reject(new Error('awaited load failed'));
		await expect(current).rejects.toThrow('awaited load failed');
		await settled();
		expect(f.child.isDestroyed).toBe(false);
		expect(f.onError).not.toHaveBeenCalled();
		expect(f.app.find('p').textContent).toBe('initial');
	});

	it('a synchronous data() throw still escapes refresh synchronously', async () => {
		const f = await refreshFixture();
		const failure = new Error('sync failure');
		vi.spyOn(f.child, 'data').mockImplementation(() => { throw failure; });
		expect(() => f.child.refresh()).toThrow(failure);
		expect(f.onError).not.toHaveBeenCalled();
	});

	it('a stale fulfillment still leaves the newer synchronous commit intact', async () => {
		const f = await refreshFixture();
		const old = f.change('old');
		expect(f.change('new')).toBeUndefined();
		const element = f.child.element;
		f.remote.resolve({ id: 'old', title: 'old server result' });
		await old;
		await settled();

		expect(f.app.find('p').textContent).toBe('new');
		expect(f.app.find('.child')).toBe(element);
		expect(f.child.isDestroyed).toBe(false);
		expect(f.onError).not.toHaveBeenCalled();
		expect(f.app.store._heldKeys.get(f.child)).toBeUndefined();
	});
});

class Org extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), name: Puzzle.string() };
}

function shellFixture() {
	const gate = deferred();
	const started = deferred();
	class OrgShell extends PuzzleView {
		async data(params) {
			const org = this.ctx.store.findOne('org', params.id);
			if (params.id === '2') {
				started.resolve();
				await gate.promise;
			}
			return { label: org.name };
		}
		render() {
			return h('section', { class: 'org' }, [
				h('h1', {}, [text(this.getData().label)]),
				h('div', {}, [h(SLOT_TAG)]),
			]);
		}
	}
	return { OrgShell, gate, started };
}

const keys = (store, view) => [...(store.keysBySubscriber.get(view) ?? [])].sort();
const held = (store, view) => [...(store._heldKeys.get(view) ?? [])].map(([key, entry]) => [key, entry.count]);
const seed = (store) => {
	store.createRecord('org', { id: '1', name: 'ORG 1' });
	store.createRecord('org', { id: '2', name: 'ORG 2' });
	store.flush();
};

async function prepareFixture(withAdapter) {
	const f = shellFixture();
	const view = await mountView(f.OrgShell, {
		params: { id: '1' },
		props: { label: 'committed' },
		route: { path: '/org/1/home', params: { id: '1' } },
		store: makeOrgStore(withAdapter),
	});
	handles.push(view);
	const baseline = keys(view.store, view.instance);
	const baselineHeld = held(view.store, view.instance);
	const model = view.instance.getData();
	const route = view.instance.route;
	const prepared = view.instance.prepareRefresh({
		params: { id: '2' },
		props: { label: 'prepared' },
		route: { path: '/org/2/home', params: { id: '2' } },
	});
	await f.started.promise;
	return { ...f, view, prepared, baseline, baselineHeld, model, route };
}

// Core and adapter stores exercise the two different publishers of pending.reconcile.
function makeOrgStore(withAdapter) {
	const store = new Store({ org: Org }, withAdapter ? { adapter: { d: undefined } } : {});
	seed(store);
	return store;
}

function expectCommitted(f) {
	expect(f.view.instance.isDestroyed).toBe(false);
	expect(f.view.instance.params.id).toBe('1');
	expect(f.view.instance.props.label).toBe('committed');
	expect(f.view.instance.route).toBe(f.route);
	expect(f.view.instance.getData()).toEqual(f.model);
	expect(f.view.find('h1').textContent).toBe('ORG 1');
	expect(keys(f.view.store, f.view.instance)).toEqual(f.baseline);
	expect(held(f.view.store, f.view.instance)).toEqual(f.baselineHeld);
}

describe.each([false, true])('R2 — prepared refresh decisions (adapter=%s)', (withAdapter) => {
	it('releases a lease published after discard, on the still-live ancestor', async () => {
		const f = await prepareFixture(withAdapter);
		expect(f.baselineHeld).toEqual([]);
		f.prepared.discard();
		f.gate.resolve();
		await f.prepared.ready;
		f.prepared.commit(); // late success cannot undo discard
		expectCommitted(f);
	});

	it('still releases an already-ready lease on discard', async () => {
		const f = await prepareFixture(withAdapter);
		f.gate.resolve();
		await f.prepared.ready;
		expect(held(f.view.store, f.view.instance)).toEqual([['org 2', 1]]);
		f.prepared.discard();
		expectCommitted(f);
	});

	it('still adopts a ready lease on commit and ignores a later discard', async () => {
		const f = await prepareFixture(withAdapter);
		f.gate.resolve();
		await f.prepared.ready;
		f.prepared.commit();
		f.prepared.discard();
		expect(f.view.instance.params.id).toBe('2');
		expect(f.view.instance.props.label).toBe('prepared');
		expect(f.view.instance.route.path).toBe('/org/2/home');
		expect(f.view.find('h1').textContent).toBe('ORG 2');
		expect(keys(f.view.store, f.view.instance)).toEqual(['org 2']);
		expect(held(f.view.store, f.view.instance)).toEqual(f.baselineHeld);
		f.view.store.findOne('org', '2').update({ name: 'RENAMED' });
		await settled();
		expect(f.view.find('h1').textContent).toBe('RENAMED');
	});

	it('double discard is a no-op before and after late publication', async () => {
		const f = await prepareFixture(withAdapter);
		f.prepared.discard();
		expect(() => f.prepared.discard()).not.toThrow();
		f.gate.resolve();
		await f.prepared.ready;
		expectCommitted(f);
		f.prepared.discard();
		expectCommitted(f);
	});

	it('a late rejection preserves discard and only rejects the observed ready promise', async () => {
		const f = await prepareFixture(withAdapter);
		const failure = new Error('discarded evaluation failed');
		const rejected = expect(f.prepared.ready).rejects.toBe(failure);
		f.prepared.discard();
		f.gate.reject(failure);
		await rejected;
		expect(() => f.prepared.discard()).not.toThrow();
		f.prepared.commit();
		expectCommitted(f);
	});

	it('real router fail-fast rejection discards a suspended ancestor without stranding its keys', async () => {
		const f = shellFixture();
		const bad = deferred();
		const badStarted = deferred();
		let shell;
		class OrgShell extends f.OrgShell {
			created() { shell = this; }
		}
		class HomeLeaf extends PuzzleView {
			render() { return h('p', { class: 'home' }, [text('HOME')]); }
		}
		class BadLeaf extends PuzzleView {
			async data() {
				badStarted.resolve();
				await bad.promise;
				return {};
			}
		}
		const onError = vi.fn();
		const app = await createTestApp({
			routerInitialPath: '/org/1/home',
			routes: [{
				path: '/org/:id', view: OrgShell,
				children: [
					{ path: 'home', view: HomeLeaf },
					{ path: 'bad', view: BadLeaf },
				],
			}],
			models: { org: Org },
			...(withAdapter ? { adapter } : {}),
			beforeMount(app) { seed(app.store); },
			onError,
		});
		handles.push(app);
		const baseline = keys(app.store, shell);
		const baselineHeld = held(app.store, shell);
		const model = shell.getData();
		const route = shell.route;
		const element = shell.element;
		const prepare = vi.spyOn(shell, 'prepareRefresh');
		const nav = app.router.push('/org/2/bad');
		await badStarted.promise;
		bad.reject(new Error('bad leaf failed'));
		// Releasing the failing leaf's tracking scope starts the queued shell before
		// Promise.all's rejection reaches the router's discardPrepared catch.
		await f.started.promise;
		await nav;
		const prepared = prepare.mock.results[0].value;
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][1].phase).toBe('navigation');
		expect(app.router.current.path).toBe('/org/1/home');
		expect(shell.getData()).toEqual(model);
		expect(app.find('h1').textContent).toBe('ORG 1');

		f.gate.resolve();
		await prepared.ready;
		await settled();
		expect(shell.isDestroyed).toBe(false);
		expect(app.find('.org')).toBe(element);
		expect(shell.params.id).toBe('1');
		expect(shell.route).toBe(route);
		expect(shell.getData()).toEqual(model);
		expect(keys(app.store, shell)).toEqual(baseline);
		expect(held(app.store, shell)).toEqual(baselineHeld);
		expect(app.find('.home').textContent).toBe('HOME');

		await app.router.push('/org/1/home?retry=1');
		await settled();
		expect(app.router.current.path).toBe('/org/1/home?retry=1');
		expect(keys(app.store, shell)).toEqual(baseline);
		expect(held(app.store, shell)).toEqual(baselineHeld);
		app.store.findOne('org', '1').update({ name: 'STILL LIVE' });
		await settled();
		expect(app.find('h1').textContent).toBe('STILL LIVE');
		expect(onError).toHaveBeenCalledOnce();
	});
});
