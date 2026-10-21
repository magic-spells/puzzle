// @vitest-environment jsdom
// app.idle() (D185): resolves true once two consecutive frames find the app
// quiet, false on timeout, and never rejects.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { adapter } from '../client-runtime/datastore/adapter.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A promise plus its resolver. */
function gate() {
	let open;
	const promise = new Promise((r) => (open = r));
	return { promise, open };
}

/** Track a promise's settlement without awaiting it. */
function watch(promise) {
	const state = { done: false, value: undefined };
	promise.then((v) => {
		state.done = true;
		state.value = v;
	});
	return state;
}

class Note extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), text: Puzzle.string() };
}

class Todo extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), text: Puzzle.string() };
	static adapter = { endpoint: '/api/todos' };
}

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

// Renders every note's text; re-renders on a store change.
class NotesView extends PuzzleView {
	data() {
		return { notes: this.ctx.store.findMany('note') };
	}
	render() {
		return h('puzzle-view', { class: 'notes' }, [
			text(this.getData().notes.map((n) => n.text).join(',')),
		]);
	}
}

let apps = [];
function make(config) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const app = new PuzzleApp({ target: el, ...config });
	apps.push(app);
	return { app, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
});

afterEach(() => {
	apps.forEach((a) => a.unmount());
	apps = [];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('app.idle() (D185)', () => {
	it('is idle right after mount', async () => {
		const { app } = make({ routes: [{ path: '/', view: HomeView }] });
		await app.mount();
		expect(await app.idle()).toBe(true);
	});

	it('waits for a slow async data() a store change started', async () => {
		const slow = gate();
		let runs = 0;
		class SlowView extends PuzzleView {
			async data() {
				const notes = this.ctx.store.findMany('note');
				if (runs++ > 0) await slow.promise;
				return { notes };
			}
			render() {
				return h('puzzle-view', { class: 'slow' }, [text(String(this.getData().notes.length))]);
			}
		}
		const { app, el } = make({ models: { note: Note }, routes: [{ path: '/', view: SlowView }] });
		await app.mount();

		app.store.createRecord('note', { id: 'n1', text: 'a' });
		const idle = watch(app.idle());
		await wait(80);
		expect(app.store._asyncTrackingChain).not.toBeNull();
		expect(idle.done).toBe(false);

		slow.open();
		await vi.waitFor(() => expect(idle.done).toBe(true));
		expect(idle.value).toBe(true);
		expect(el.querySelector('.slow').textContent).toBe('1');
	});

	it('waits for an in-flight push', async () => {
		// An async guard: navigation work outside any data() evaluation, so only
		// the router's in-flight state covers it.
		const slow = gate();
		class AboutView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
			}
		}
		const { app, el } = make({
			routes: [
				{ path: '/', view: HomeView },
				{ path: '/about', view: AboutView, guard: () => slow.promise.then(() => true) },
			],
		});
		await app.mount();

		app.router.push('/about');
		const idle = watch(app.idle());
		await wait(80);
		expect(app.store._asyncTrackingChain).toBeNull();
		expect(idle.done).toBe(false);
		expect(el.querySelector('.about')).toBeNull();

		slow.open();
		await vi.waitFor(() => expect(idle.done).toBe(true));
		expect(idle.value).toBe(true);
		expect(el.querySelector('.about')).not.toBeNull();
	});

	it('waits for a store change to flush and re-render', async () => {
		const { app, el } = make({ models: { note: Note }, routes: [{ path: '/', view: NotesView }] });
		await app.mount();

		app.store.createRecord('note', { id: 'n1', text: 'hello' });
		expect(app.store._flushScheduled).toBe(true);
		expect(el.querySelector('.notes').textContent).toBe('');

		expect(await app.idle()).toBe(true);
		expect(el.querySelector('.notes').textContent).toBe('hello');
	});

	it('is not idle while a scheduled store flush has not run', async () => {
		const { app, el } = make({ models: { note: Note }, routes: [{ path: '/', view: NotesView }] });
		await app.mount();
		// Hold the flush back so the scheduled-flush state is the only signal.
		const flush = vi.spyOn(app.store, 'flush').mockImplementation(() => {});
		app.store.createRecord('note', { id: 'n1', text: 'held' });
		expect(await app.idle({ timeout: 60 })).toBe(false);

		flush.mockRestore();
		app.store.flush();
		expect(await app.idle()).toBe(true);
		expect(el.querySelector('.notes').textContent).toBe('held');
	});

	it('waits for a setData() render', async () => {
		let view;
		class LocalView extends PuzzleView {
			mounted() {
				view = this;
			}
			render() {
				return h('puzzle-view', { class: 'local' }, [text(String(this.getData().n ?? 0))]);
			}
		}
		const { app, el } = make({ routes: [{ path: '/', view: LocalView }] });
		await app.mount();
		view.setData({ n: 5 });
		expect(el.querySelector('.local').textContent).toBe('0');
		expect(await app.idle()).toBe(true);
		expect(el.querySelector('.local').textContent).toBe('5');
	});

	it('adapter app: waits for a fetch-backed find to settle', async () => {
		const response = gate();
		vi.stubGlobal('fetch', async (url) => {
			if (String(url).endsWith('/api/todos/t2')) {
				await response.promise;
				return {
					ok: true,
					status: 200,
					statusText: 'OK',
					text: async () => JSON.stringify({ id: 't2', text: 'second' }),
					json: async () => ({ id: 't2', text: 'second' }),
				};
			}
			throw new Error(`unexpected fetch ${url}`);
		});
		// Sync data(): the find's fetch is the only thing in flight while it settles,
		// so no async data() chain covers it.
		class TodoView extends PuzzleView {
			data() {
				const sel = this.ctx.store.findOne('note', 'sel');
				return { todo: sel ? this.ctx.store.findOne('todo', sel.text) : null };
			}
			render() {
				return h('puzzle-view', { class: 'todo' }, [text(this.getData().todo?.text ?? '-')]);
			}
		}
		const { app, el } = make({
			apiURL: 'https://x.test',
			adapter,
			models: { note: Note, todo: Todo },
			routes: [{ path: '/', view: TodoView }],
		});
		await app.mount();
		expect(el.querySelector('.todo').textContent).toBe('-');

		app.store.createRecord('note', { id: 'sel', text: 't2' });
		const idle = watch(app.idle());
		await wait(80);
		expect(app.store._reading()).toBe(true);
		expect(app.store._asyncTrackingChain).toBeNull();
		expect(idle.done).toBe(false);

		response.open();
		await vi.waitFor(() => expect(idle.done).toBe(true));
		expect(idle.value).toBe(true);
		expect(el.querySelector('.todo').textContent).toBe('second');
	});

	it('resolves false when the timeout runs out', async () => {
		const never = gate();
		class StuckView extends PuzzleView {
			async data() {
				await never.promise;
				return {};
			}
			render() {
				return h('puzzle-view', {}, []);
			}
		}
		const { app } = make({
			routes: [
				{ path: '/', view: HomeView },
				{ path: '/stuck', view: StuckView },
			],
		});
		await app.mount();
		app.router.push('/stuck');
		const started = Date.now();
		expect(await app.idle({ timeout: 60 })).toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(55);
		never.open();
	});

	it('logs a dev error for a bad timeout and still resolves', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { app } = make({ routes: [{ path: '/', view: HomeView }] });
		await app.mount();
		for (const bad of [-1, NaN, Infinity, '100']) {
			expect(await app.idle({ timeout: bad })).toBe(true);
		}
		expect(error).toHaveBeenCalledTimes(4);
		expect(error.mock.calls[0][0]).toMatch(/app\.idle\(\) timeout/);
	});

	it('steps on timers in a hidden tab, where rAF is frozen', async () => {
		const { app, el } = make({ models: { note: Note }, routes: [{ path: '/', view: NotesView }] });
		await app.mount();
		const raf = vi.fn(() => 0); // a frozen rAF: never calls back
		vi.stubGlobal('requestAnimationFrame', raf);
		vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

		app.store.createRecord('note', { id: 'n1', text: 'bg' });
		expect(await app.idle()).toBe(true);
		expect(raf).not.toHaveBeenCalled();
		expect(el.querySelector('.notes').textContent).toBe('bg');
	});

	it('renders a setData() in a hidden tab, and waits for it', async () => {
		let view;
		class LocalView extends PuzzleView {
			mounted() {
				view = this;
			}
			render() {
				return h('puzzle-view', { class: 'local' }, [text(String(this.getData().n ?? 0))]);
			}
		}
		const { app, el } = make({ routes: [{ path: '/', view: LocalView }] });
		await app.mount();
		const raf = vi.fn(() => 0); // frozen
		vi.stubGlobal('requestAnimationFrame', raf);
		vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

		view.setData({ n: 7 });
		expect(el.querySelector('.local').textContent).toBe('0');
		const idle = watch(app.idle());
		// Never true while the old value is still on screen.
		await vi.waitFor(() => expect(idle.done).toBe(true));
		expect(idle.value).toBe(true);
		expect(el.querySelector('.local').textContent).toBe('7');
		expect(raf).not.toHaveBeenCalled();
	});

	it('waits for a setLocale() switch whose table is still loading', async () => {
		const held = gate();
		vi.stubGlobal('fetch', async (url) => {
			if (String(url).endsWith('es.json')) await held.promise;
			const body = String(url).endsWith('es.json') ? { hi: 'Hola' } : { hi: 'Hello' };
			return { ok: true, status: 200, json: async () => body };
		});
		class HiView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'hi' }, [text(this.ctx.i18n.t('hi'))]);
			}
		}
		const { app, el } = make({
			routes: [{ path: '/', view: HiView }],
			__i18n: {
				manifest: { defaultLocale: 'en', locales: { en: 'locales/en.json', es: 'locales/es.json' } },
				locale: 'en',
			},
		});
		await app.mount();
		expect(el.querySelector('.hi').textContent).toBe('Hello');

		const switching = app.i18n.setLocale('es');
		const idle = watch(app.idle());
		await wait(80);
		expect(app.i18n.__busy).toBe(true);
		expect(idle.done).toBe(false);

		held.open();
		await switching;
		await vi.waitFor(() => expect(idle.done).toBe(true));
		expect(idle.value).toBe(true);
		expect(app.i18n.__busy).toBe(false);
		expect(el.querySelector('.hi').textContent).toBe('Hola');
	});

	it('falls back to the timer when a visible tab rAF never fires', async () => {
		const { app } = make({ routes: [{ path: '/', view: HomeView }] });
		await app.mount();
		const raf = vi.fn(() => 0);
		vi.stubGlobal('requestAnimationFrame', raf);
		expect(await app.idle()).toBe(true);
		expect(raf).toHaveBeenCalled();
	});

	it('waits for a mount in flight', async () => {
		const slow = gate();
		const { app, el } = make({
			routes: [{ path: '/', view: HomeView }],
			beforeMount: () => slow.promise,
		});
		const mounting = app.mount();
		const idle = watch(app.idle());
		await wait(80);
		expect(idle.done).toBe(false);

		slow.open();
		await mounting;
		await vi.waitFor(() => expect(idle.done).toBe(true));
		expect(idle.value).toBe(true);
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('resolves true at once when not mounted: never mounted, or after unmount', async () => {
		const { app } = make({ routes: [{ path: '/', view: HomeView }] });
		const raf = vi.fn(() => 0);
		vi.stubGlobal('requestAnimationFrame', raf);
		expect(await app.idle()).toBe(true);

		vi.unstubAllGlobals();
		await app.mount();
		app.unmount();
		vi.stubGlobal('requestAnimationFrame', raf);
		vi.spyOn(globalThis, 'setTimeout');
		expect(await app.idle()).toBe(true);
		expect(raf).not.toHaveBeenCalled();
		expect(setTimeout).not.toHaveBeenCalled();
	});
});
