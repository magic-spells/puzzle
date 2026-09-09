// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView, ViewNode } from '../client-runtime/index.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import {
	createTestApp,
	installFakeAnimate,
	installFakeObserver,
	mountView,
	settled,
} from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const handles = [];
const installs = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	for (const install of installs.splice(0).reverse()) install.uninstall();
});

describe('@magic-spells/puzzle/testing — mountView', () => {
	it('accepts the adapter capability option and rejects a raw object', async () => {
		class Probe extends PuzzleView {
			data() {
				return { installed: typeof this.ctx.store.loadMany === 'function' };
			}
			render() {
				return h('span', {}, [text(this.getData().installed)]);
			}
		}

		await expect(mountView(Probe, { adapter: { endpoint: '/api' } })).rejects.toThrow(
			/options\.adapter.*@magic-spells\/puzzle\/adapter/
		);
		class Note extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
			static adapter = { endpoint: '/notes' };
		}
		const configured = adapter.defaults({
			loadMany: async () => [{ id: 'n1' }],
		});
		const view = await mountView(Probe, {
			adapter: configured,
			models: { note: Note },
		});
		handles.push(view);
		expect(view.element.textContent).toBe('true');
		await expect(view.store.loadMany('note')).resolves.toHaveLength(1);
	});

	it('mounts detached with the complete ctx, query helpers, click(), and setProps()', async () => {
		class Counter extends PuzzleView {
			data(params, props) {
				return {
					label: props.label,
					items: this.ctx.store.findMany('item'),
				};
			}

			events = {
				add: () => this.ctx.store.createRecord('item', { value: 'new' }),
			};

			render() {
				const data = this.getData();
				return h('section', {}, [
					h('span', { class: 'label' }, [text(data.label)]),
					h('button', { class: 'add', '@click': this.events.add }, [text('Add')]),
					h(
						'ul',
						{},
						data.items.map((item) => h('li', { key: item.id }, [text(item.value)]))
					),
				]);
			}
		}

		const view = await mountView(Counter, { props: { label: 'Open' } });
		handles.push(view);

		expect(view.container.isConnected).toBe(false);
		expect(Object.keys(view.ctx).sort()).toEqual(['formatters', 'router', 'store']);
		expect(view.element.tagName).toBe('SECTION');
		expect(view.find('.label').textContent).toBe('Open');
		expect(view.findAll('li')).toEqual([]);

		await view.click('.add');
		expect(view.findAll('li')).toHaveLength(1);
		expect(view.find('li').textContent).toBe('new');

		await view.setProps({ label: 'Done' });
		expect(view.find('.label').textContent).toBe('Done');
	});

	it('delivers route to the first data() through the preload path', async () => {
		const routeDef = { path: '/todos/:id', name: 'todo', view: null };
		const route = {
			path: '/todos/42?tab=open',
			pathname: '/todos/42',
			query: Object.freeze(Object.assign(Object.create(null), { tab: 'open' })),
			hash: '',
			route: routeDef,
			params: { id: '42' },
			chain: [routeDef],
		};
		const seen = [];

		class Routed extends PuzzleView {
			data(params, props) {
				seen.push({ params, props, route: this.route });
				return { id: params.id, filter: props.filter, path: this.route.path };
			}
			render() {
				const data = this.getData();
				return h('div', {}, [
					h('span', { class: 'value' }, [
						text(`${data.id}:${data.filter}:${data.path}`),
					]),
				]);
			}
		}

		const view = await mountView(Routed, {
			params: route.params,
			props: { filter: 'open' },
			route,
		});
		handles.push(view);

		expect(seen).toEqual([{ params: route.params, props: { filter: 'open' }, route }]);
		expect(view.find('.value').textContent).toBe('42:open:/todos/42?tab=open');
		expect(view.router.current).toBe(route);
	});

	it('click() waits for store.flush() and the async data() refresh it starts', async () => {
		let nextGate = null;

		class AsyncCounter extends PuzzleView {
			data() {
				const count = this.ctx.store.findMany('item').length;
				if (nextGate) return nextGate.promise.then(() => ({ count }));
				return { count };
			}

			events = {
				add: () => this.ctx.store.createRecord('item', {}),
			};

			render() {
				return h('div', {}, [
					h('button', { class: 'add', '@click': this.events.add }, [text('Add')]),
					h('span', { class: 'count' }, [text(this.getData().count)]),
				]);
			}
		}

		const view = await mountView(AsyncCounter);
		handles.push(view);
		nextGate = deferred();

		let clickSettled = false;
		const click = view.click('.add').then(() => {
			clickSettled = true;
		});
		await Promise.resolve();

		expect(clickSettled).toBe(false);
		expect(view.find('.count').textContent).toBe('0');

		nextGate.resolve();
		await click;
		expect(view.find('.count').textContent).toBe('1');
	});

	it('tracks only the current data() promise when a newer refresh supersedes it', async () => {
		const oldGate = deferred();
		const newGate = deferred();
		const store = {
			withTracking(_subscriber, run) {
				return run();
			},
			flush() {},
			unsubscribe() {},
		};

		class LastWins extends PuzzleView {
			data(_params, props) {
				if (props.value === 'old') return oldGate.promise;
				if (props.value === 'new') return newGate.promise;
				return { value: props.value };
			}
			render() {
				return h('div', {}, [
					h('span', { class: 'value' }, [text(this.getData().value)]),
				]);
			}
		}

		const view = await mountView(LastWins, {
			store,
			props: { value: 'initial' },
		});
		handles.push(view);

		view.instance.applyParentUpdate({ props: { value: 'old' } });
		view.instance.applyParentUpdate({ props: { value: 'new' } });
		const wait = settled();
		newGate.resolve({ value: 'new' });
		await wait;

		expect(view.find('.value').textContent).toBe('new');

		// The older promise was superseded and did not hold settled() open. Its
		// eventual result is discarded by PuzzleView's normal last-wins token.
		oldGate.resolve({ value: 'old' });
		await Promise.resolve();
		expect(view.find('.value').textContent).toBe('new');
	});

	it('destroy() is idempotent and removes the mounted subtree', async () => {
		class V extends PuzzleView {
			render() {
				return h('div', {}, [h('span', { class: 'inside' }, [])]);
			}
		}
		const view = await mountView(V);
		expect(view.find('.inside')).not.toBeNull();

		view.destroy();
		view.destroy();
		expect(view.instance.isDestroyed).toBe(true);
		expect(view.container.childNodes).toHaveLength(0);
	});
});

describe('@magic-spells/puzzle/testing — createTestApp', () => {
	it('visit() drives the real memory router and exposes live app services', async () => {
		class Home extends PuzzleView {
			render() {
				return h('puzzle-view', {}, [h('span', { class: 'home' }, [text('home')])]);
			}
		}
		class Todo extends PuzzleView {
			data(params) {
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', {}, [
					h('span', { class: 'todo' }, [text(this.getData().id)]),
				]);
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', name: 'home', view: Home },
				{ path: '/todos/:id', name: 'todo', view: Todo },
			],
		});
		handles.push(app);

		expect(app.element.isConnected).toBe(false);
		expect(app.find('.home')).not.toBeNull();
		expect(app.store).toBe(app.app.store);
		expect(app.router).toBe(app.app.router);

		await app.visit('/todos/42');
		expect(app.router.current.path).toBe('/todos/42');
		expect(app.find('.todo').textContent).toBe('42');
	});

	it('click() waits for a navigation started inside a view event handler', async () => {
		const gate = deferred();

		class Home extends PuzzleView {
			events = { go: () => this.ctx.router.push('/slow') };
			render() {
				return h('puzzle-view', {}, [
					h('button', { class: 'go', '@click': this.events.go }, [text('Go')]),
				]);
			}
		}
		class Slow extends PuzzleView {
			async data() {
				await gate.promise;
				return { ready: true };
			}
			render() {
				return h('puzzle-view', {}, [
					h('span', { class: 'slow' }, [text('ready')]),
				]);
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', name: 'home', view: Home },
				{ path: '/slow', name: 'slow', view: Slow },
			],
		});
		handles.push(app);

		let clickSettled = false;
		const click = app.click('.go').then(() => {
			clickSettled = true;
		});
		await Promise.resolve();

		expect(clickSettled).toBe(false);
		expect(app.router.current.path).toBe('/');
		expect(app.find('.slow')).toBeNull();

		gate.resolve();
		await click;
		expect(app.router.current.path).toBe('/slow');
		expect(app.find('.slow')).not.toBeNull();
	});
});

describe('@magic-spells/puzzle/testing — settled convergence guard', () => {
	it('diagnoses a data-store feedback loop instead of hanging', async () => {
		class FeedbackLoop extends PuzzleView {
			looping = false;

			data() {
				const items = this.ctx.store.findMany('item');
				if (this.looping && items.length > 0) {
					this.ctx.store.createRecord('item', {});
				}
				return { count: items.length };
			}

			render() {
				return h('div', {}, [text(this.getData().count)]);
			}
		}

		const view = await mountView(FeedbackLoop);
		handles.push(view);
		view.instance.looping = true;
		view.store.createRecord('item', {});

		let error;
		try {
			await settled({ maxPasses: 3 });
		} catch (caught) {
			error = caught;
		} finally {
			view.instance.looping = false;
		}

		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe(
			'[puzzle/testing] settled() did not converge after 3 passes — ' +
				'framework work was still being scheduled ' +
				'(workVersion advanced 6 times across 3 passes). ' +
				'Most active: store notifications for item (6), ' +
				'view FeedbackLoop data refresh (6). ' +
				'Likely cause: a data() → store-write → data() cycle, ' +
				'or a timer mutating the store. ' +
				'Raise the bound with settled({ maxPasses }) if convergence is legitimately slow.'
		);
		await settled();
	});

	it('leaves normal two-pass convergence unaffected', async () => {
		class LocalUpdate extends PuzzleView {
			data() {
				return { count: 0 };
			}

			render() {
				return h('div', {}, [
					h('span', { class: 'count' }, [text(this.getData().count)]),
				]);
			}
		}

		const view = await mountView(LocalUpdate);
		handles.push(view);
		view.instance.setData('count', 1);

		await expect(settled({ maxPasses: 2 })).resolves.toBeUndefined();
		expect(view.find('.count').textContent).toBe('1');
	});

	it('honors a lower cap and lets a raised cap finish a slower update chain', async () => {
		class SlowConvergence extends PuzzleView {
			remaining = 0;

			data() {
				return { count: 0 };
			}

			afterUpdate() {
				if (this.remaining === 0) return;
				this.remaining--;
				this.setData('count', this.getData().count + 1);
			}

			render() {
				return h('div', {}, [
					h('span', { class: 'count' }, [text(this.getData().count)]),
				]);
			}
		}

		const view = await mountView(SlowConvergence);
		handles.push(view);
		view.instance.remaining = 5;
		view.instance.setData('count', 1);

		await expect(settled({ maxPasses: 1 })).rejects.toThrow(
			'did not converge after 1 pass'
		);
		await expect(settled({ maxPasses: 10 })).resolves.toBeUndefined();
		expect(view.instance.remaining).toBe(0);
		expect(view.find('.count').textContent).toBe('6');
	});
});

describe('@magic-spells/puzzle/testing — environment fakes', () => {
	it('fake WAAPI is deferred, records calls without a runner, and restores globals', async () => {
		const originalAnimate = Element.prototype.animate;
		const originalGetAnimations = Element.prototype.getAnimations;
		const waapi = installFakeAnimate();
		installs.push(waapi);
		const element = document.createElement('div');
		const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
			duration: 100,
		});

		expect(waapi.animations).toEqual([animation]);
		expect(waapi.animateCalls).toEqual([
			[element, [{ opacity: 0 }, { opacity: 1 }], { duration: 100 }],
		]);
		animation.pause();
		animation.play();
		expect(animation.pause.calls).toHaveLength(1);
		expect(animation.play.calls).toHaveLength(1);

		let finished = false;
		animation.finished.then(() => {
			finished = true;
		});
		await settled();
		expect(finished).toBe(false);

		animation.finish();
		await animation.finished;
		expect(finished).toBe(true);

		waapi.uninstall();
		expect(Element.prototype.animate).toBe(originalAnimate);
		expect(Element.prototype.getAnimations).toBe(originalGetAnimations);
	});

	it('fake observer triggers D73 visible enters and restores the previous global', async () => {
		const originalObserver = globalThis.IntersectionObserver;
		const waapi = installFakeAnimate();
		const observer = installFakeObserver();
		installs.push(waapi, observer);

		class Visible extends PuzzleView {
			animations = {
				in: {
					from: { opacity: 0 },
					to: { opacity: 1 },
					duration: 100,
					trigger: 'visible',
				},
			};
			render() {
				return h('div', {}, [h('span', { class: 'content' }, [text('visible')])]);
			}
		}

		const view = await mountView(Visible);
		handles.push(view);
		const entering = view.instance.playIn();

		expect(observer.observers).toHaveLength(1);
		expect(observer.observers[0].observed.has(view.element)).toBe(true);
		expect(waapi.animations[0].pause.calls).toHaveLength(1);
		expect(waapi.animations[0].play.calls).toHaveLength(0);

		observer.trigger(view.element);
		expect(waapi.animations[0].play.calls).toHaveLength(1);
		waapi.animations[0].finish();
		await entering;
		await Promise.resolve();
		expect(waapi.animations[0].cancel.calls).toHaveLength(1);

		observer.uninstall();
		expect(globalThis.IntersectionObserver).toBe(originalObserver);
	});
});
