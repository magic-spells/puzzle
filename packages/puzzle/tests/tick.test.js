// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

class Note extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), text: Puzzle.string() };
}

const text = (value) => new ViewNode('puzzle-view', {}, [new ViewNode('text', { value: String(value) })]);
let apps;
let frames;

async function mount(View, config = {}) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	let view;
	class Subject extends View {
		mounted() { view = this; }
	}
	const app = new PuzzleApp({ target: el, models: { note: Note }, routes: [{ path: '/', view: Subject }], ...config });
	apps.push(app);
	await app.mount();
	return { app, view, el };
}

class Local extends PuzzleView {
	render() { return text(this.getData().n ?? 0); }
}

function watch(promise) {
	const state = { done: false };
	promise.then(() => { state.done = true; });
	return state;
}

async function frame() {
	const current = frames.splice(0);
	current.forEach((callback) => callback());
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	apps = [];
	frames = [];
	document.body.innerHTML = '';
	history.replaceState({}, '', '/');
	vi.useFakeTimers();
	vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
	vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback));
});

afterEach(async () => {
	apps.forEach((app) => app.unmount());
	await vi.runAllTimersAsync();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('tick() (D188)', () => {
	it('is a view method that resolves void when nothing is scheduled', async () => {
		expect(await new PuzzleView().tick()).toBeUndefined();
	});

	it('waits for a scheduled local render, with concurrent callers', async () => {
		const { app, view, el } = await mount(Local);
		view.setData('n', 1);
		const a = view.tick();
		const b = view.tick();
		const state = watch(a);
		await Promise.resolve();
		expect(state.done).toBe(false);
		expect(el.textContent).toBe('0');
		await frame();
		await Promise.all([a, b]);
		expect(el.textContent).toBe('1');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('waits for every render scheduled by update hooks', async () => {
		class Cascade extends Local {
			afterUpdate() {
				const n = this.getData().n;
				if (n < 3) this.setData('n', n + 1);
			}
		}
		const { app, view, el } = await mount(Cascade);
		view.setData('n', 1);
		const pending = view.tick();
		const state = watch(pending);
		await frame();
		expect(el.textContent).toBe('1');
		expect(state.done).toBe(false);
		await frame();
		expect(el.textContent).toBe('2');
		expect(state.done).toBe(false);
		await frame();
		await pending;
		expect(el.textContent).toBe('3');
	});

	it('includes a render queued by an update hook microtask', async () => {
		class Cascade extends Local {
			afterUpdate() {
				if (this.getData().n === 1) Promise.resolve().then(() => this.setData('n', 2));
			}
		}
		const { app, view, el } = await mount(Cascade);
		view.setData('n', 1);
		const pending = view.tick();
		const state = watch(pending);
		await frame();
		expect(state.done).toBe(false);
		await frame();
		await pending;
		expect(el.textContent).toBe('2');
		view.setData('n', 3);
		const next = view.tick();
		await frame();
		await next;
		expect(el.textContent).toBe('3');
	});

	it('waits for store delivery and the local render it schedules', async () => {
		class Notes extends PuzzleView {
			data() { return { notes: this.ctx.store.findMany('note') }; }
			afterUpdate() {
				if (this.getData().notes.length && !this.getData().ready) this.setData('ready', true);
			}
			render() { return text(`${this.getData().notes.length}:${this.getData().ready ?? false}`); }
		}
		const { app, view, el } = await mount(Notes);
		app.store.createRecord('note', { id: 'a', text: 'first' });
		const pending = view.tick();
		const state = watch(pending);
		await frame();
		expect(el.textContent).toBe('1:false');
		expect(state.done).toBe(false);
		await frame();
		await pending;
		expect(el.textContent).toBe('1:true');
	});

	it('includes a store flush scheduled during subscriber delivery', async () => {
		const { app, view } = await mount(Local);
		let deliveries = 0;
		app.store.withTracking({ onStoreChange() {
			if (++deliveries === 1) app.store.createRecord('note', { id: 'b', text: 'second' });
		} }, () => app.store.findMany('note'));
		app.store.createRecord('note', { id: 'a', text: 'first' });
		const pending = view.tick();
		const state = watch(pending);
		await frame();
		expect(deliveries).toBe(1);
		expect(state.done).toBe(false);
		await frame();
		await pending;
		expect(deliveries).toBe(2);
	});

	it('covers nested components sharing the scheduler', async () => {
		let child;
		class Child extends Local {
			mounted() { child = this; }
		}
		class Parent extends PuzzleView {
			render() { return new ViewNode('puzzle-view', {}, [new ViewNode(Child)]); }
			afterUpdate() { child.setData('n', 2); }
		}
		const { app, view, el } = await mount(Parent);
		view.setData('changed', true);
		const pending = view.tick();
		await frame();
		await frame();
		await pending;
		expect(el.textContent).toBe('2');
	});

	it('uses timers in hidden tabs for both store flushes and local renders', async () => {
		const { app, view, el } = await mount(Local);
		vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		const raf = vi.fn();
		vi.stubGlobal('requestAnimationFrame', raf);
		app.store.createRecord('note', { id: 'a', text: 'first' });
		view.setData('n', 4);
		const pending = view.tick();
		await vi.runAllTimersAsync();
		await pending;
		expect(raf).not.toHaveBeenCalled();
		expect(app.store._flushScheduled).toBe(false);
		expect(el.textContent).toBe('4');
	});

	it('finishes when a tab hides after scheduling and ignores a late frame', async () => {
		const { app, view, el } = await mount(Local);
		const render = vi.spyOn(view, 'render');
		view.setData('n', 5);
		const pending = view.tick();
		const state = watch(pending);
		await vi.advanceTimersByTimeAsync(219);
		expect(state.done).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(el.textContent).toBe('5');
		await frame();
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('ends at the frame for jobs a manual flush or destruction already satisfied', async () => {
		const { app, view } = await mount(Local);
		const render = vi.spyOn(view, 'render');
		view.setData('n', 1);
		app.store.createRecord('note', { id: 'a', text: 'first' });
		const pending = view.tick();
		app.store.flush();
		view.destroy();
		await frame();
		await pending;
		expect(vi.getTimerCount()).toBe(0);
		expect(render).not.toHaveBeenCalled();
	});

	it('ends at the frame for a view job an immediate render satisfied', async () => {
		const { view, el } = await mount(Local);
		const render = vi.spyOn(view, 'render');
		view.setData('n', 1);
		const pending = view.tick();
		view.flushUpdates();
		expect(el.textContent).toBe('1');
		await frame();
		await pending;
		expect(vi.getTimerCount()).toBe(0);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('releases a throwing render job and accepts subsequent work', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		class Broken extends Local {
			beforeUpdate() { throw new Error('broken update'); }
		}
		const { app, view } = await mount(Broken);
		view.setData('n', 1);
		const pending = view.tick();
		await frame();
		await pending;
		expect(view.isDestroyed).toBe(true);
		const { view: next, el } = await mount(Local);
		next.setData('n', 2);
		const nextTick = next.tick();
		await frame();
		await nextTick;
		expect(el.textContent).toBe('2');
	});

	it('does not await asynchronous data', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		let open;
		const gate = new Promise((resolve) => { open = resolve; });
		class Slow extends PuzzleView {
			data() {
				const notes = this.ctx.store.findMany('note');
				return notes.length ? gate.then(() => ({ notes })) : { notes };
			}
			render() { return text(this.getData().notes.length); }
		}
		const { app, view, el } = await mount(Slow);
		app.store.createRecord('note', { id: 'a', text: 'first' });
		const pending = view.tick();
		await frame();
		await pending;
		expect(app.store._asyncTrackingChain).not.toBeNull();
		expect(el.textContent).toBe('0');
		open();
		await app.store._asyncTrackingChain;
	});

	it('does not await navigation work', async () => {
		let open;
		const gate = new Promise((resolve) => { open = resolve; });
		const { app } = await mount(Local, { routes: [
			{ path: '/', view: Local },
			{ path: '/next', view: Local, guard: () => gate },
		] });
		const navigation = app.router.push('/next');
		expect(await new PuzzleView().tick()).toBeUndefined();
		expect(app.router.current.path).toBe('/');
		open(true);
		await navigation;
	});
});
