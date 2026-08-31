// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

const API = 'https://x.test';
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const ctxWith = (store) => ({ store, router: null, formatters: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 404 ? 'Not Found' : 'OK',
	text: async () => (body === undefined ? '' : JSON.stringify(body)),
	json: async () => body,
});

class Post extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), title: Puzzle.string().required() };
	static adapter = { endpoint: '/api/posts' };
}
class Tick extends PuzzleModel {
	static schema = { id: Puzzle.string().primary() };
}

beforeEach(() => {
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('D161 settle window — only the run that owns it may clear the dirty flag', () => {
	it('a superseded run resolving its fetch does not swallow a newer run’s store notification', async () => {
		// The p1 fault answers 404 on release: a 404 is an ANSWER (no upsert, no
		// notify), so nothing but the flag under test can re-arm a re-render.
		let answerFault;
		const faulted = new Promise((resolve) => (answerFault = resolve));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await faulted;
				return json({ error: 'missing' }, 404);
			})
		);

		const store = new Store({ post: Post, tick: Tick }, { apiURL: API, adapter });

		// data() is async, so the settle window stays open across the suspension —
		// which is exactly the window onStoreChange folds a notification into.
		let gates = [];
		let autoRelease = false;
		const gate = () => {
			if (autoRelease) return Promise.resolve();
			return new Promise((resolve) => gates.push(resolve));
		};
		const releaseGate = () => gates.shift()?.();

		class View extends PuzzleView {
			async data(params) {
				const ticks = store.findMany('tick').length;
				if (params.fault) store.findOne('post', 'p1');
				await gate();
				return { ticks };
			}
			render() {
				return h('div', {}, [text(String(this.getData().ticks))]);
			}
		}

		const el = container();
		const view = new View(ctxWith(store));
		const mounted = view.mount(el, { params: { fault: false } });
		await tick();
		releaseGate();
		await mounted;
		expect(el.textContent).toBe('0');

		// Run A — faults p1, then parks in the settle loop awaiting the request.
		view.refresh({ params: { fault: true } });
		await tick();
		releaseGate(); // A's data() resolves; A now awaits its request batch
		await tick();

		// Run B — newer refresh, queries nothing missing, suspended inside data().
		// It owns the settle window from here on.
		const runB = view.refresh({ params: { fault: false } });
		await tick();

		// A store change lands mid-window: onStoreChange defers it into B's run.
		store.createRecord('tick', { id: 't1' });
		store.flush();
		expect(view._settleDirty).toBe(true);

		// A's request settles. A is superseded — it must not clear B's flag.
		answerFault();
		await tick();
		expect(view._settleDirty).toBe(true);

		autoRelease = true;
		releaseGate(); // B's data() resolves; it should take one more pass
		await runB;
		await tick();

		expect(el.textContent).toBe('1');
	});
});
