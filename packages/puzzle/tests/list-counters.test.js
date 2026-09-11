// @vitest-environment jsdom
//
// The D170 WORK COUNT, measured on the canonical app rather than on a fixture
// (the D170 gates: `benchmarks/scenarios.mjs` expects and the measured numbers
// recorded on the D170 card).
//
// `tests/list-block.test.js` proves the block's algorithm and
// `tests/static-cache.test.js` proves the `__c` contract. This file asks the
// only question an app author actually cares about, through the Go compiler's
// own output for `examples/todos`: with 200 todos on screen, how much work does
// editing ONE of them cost? The answer the plan gates on is "one row built, 199
// returned from the cache", and the oracle is devperf's `list-rows` event, which
// the list block emits once per site per pass.
//
// The second describe is the static half of the same claim: a template holding
// an `island` allocates its frozen children ONCE per instance, not once per
// render — the 20,000-vnodes-per-render measurement on
// COMPONENT-VIEW-MANAGER is what the `__c` cache exists to retire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { devperfInstallSink } from '../client-runtime/devperf.js';
import { mountView, settled } from '../client-runtime/testing/index.js';
import installFakeAnimate from './helpers/fake-waapi.js';
import TodoHome from './fixtures/todos-compiled/Home.compiled.js';
import DefaultLayout from './fixtures/todos-compiled/Default.compiled.js';
import Todo from './fixtures/todos/todo.model.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const ROWS = 200;
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

describe('one row rebuilt per single-record edit (compiled todos, 200 rows)', () => {
	let app = null;
	let waapi = null;

	beforeEach(() => {
		history.replaceState({}, '', '/');
		document.body.innerHTML = '';
		vi.spyOn(console, 'log').mockImplementation(() => {});
		waapi = installFakeAnimate();
		// The home view's tracked findMany('todo') loads the collection once (D161)
		// and the model declares an endpoint, so the boot issues one GET.
		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			text: async () => '[]',
			json: async () => [],
		})));
	});

	afterEach(() => {
		app?.unmount();
		app = null;
		waapi = null;
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	async function settle() {
		app.store.flush();
		waapi?.finishAll();
		await raf();
		app.store.flush();
		waapi?.finishAll();
		await raf();
	}

	it('builds 1 row and caches 199 when one todo is edited', async () => {
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		app = new PuzzleApp({
			target: el,
			routes: [{ path: '/', name: 'home', view: TodoHome, layout: DefaultLayout }],
			models: { todo: Todo },
		});
		await app.mount();

		const todos = [];
		for (let i = 0; i < ROWS; i++) {
			todos.push(app.store.createRecord('todo', { id: `t-${i}`, text: `todo ${i}` }));
		}
		await settle();
		expect(el.querySelectorAll('.max-h-96 > div').length).toBe(ROWS);

		// Only events from THIS pass matter, so the sink is installed after the
		// list is already on screen and its first (all-built) pass is behind us.
		const passes = [];
		const off = devperfInstallSink((event) => {
			if (event.type === 'list-rows') passes.push(event);
		});
		try {
			todos[ROWS - 3].update({ text: 'edited' });
			await settle();
		} finally {
			off();
		}

		// One loop site, one pass over it: the edited row rebuilt, every other row
		// returned by reference for patch()'s identity short-circuit to skip.
		expect(passes.length).toBe(1);
		expect(passes[0]).toMatchObject({ built: 1, cached: ROWS - 1, conservative: 0 });
		expect(el.textContent).toContain('edited');
	});
});

describe("an island's children are allocated once across renders", () => {
	const handles = [];
	let builds = 0;

	afterEach(() => {
		for (const handle of handles.splice(0)) handle.destroy();
		builds = 0;
	});

	it('builds the frozen children on the first render and never again', async () => {
		// The compiled shape for a template whose island holds static markup: the
		// children array is one `__c` site, so the seed is allocated once per
		// INSTANCE however many times the surrounding shell re-renders.
		class Shell extends PuzzleView {
			render() {
				return h('div', {}, [
					h('span', { class: 'tick' }, [text(String(this.getData().n ?? 0))]),
					h(
						'div',
						{ island: true, class: 'isle' },
						(this.__c[0] ??= buildIslandChildren())
					),
				]);
			}
		}

		function buildIslandChildren() {
			builds += 1;
			const kids = new Array(50);
			for (let i = 0; i < 50; i++) kids[i] = h('span', { class: 'leaf' }, [text(`leaf ${i}`)]);
			return kids;
		}

		const events = [];
		const off = devperfInstallSink((event) => {
			if (event.type === 'static-cache' && event.viewName === 'Shell') events.push(event);
		});
		let view;
		try {
			view = await mountView(Shell);
			handles.push(view);
			for (let n = 1; n <= 5; n++) {
				view.instance.setData('n', n);
				await settled();
			}
		} finally {
			off();
		}

		expect(builds).toBe(1);
		expect(view.findAll('.isle .leaf').length).toBe(50);
		expect(view.find('.tick').textContent).toBe('5');
		// Allocated on the first render, held on every render after it.
		expect(events.length).toBeGreaterThan(1);
		expect(events[0]).toMatchObject({ built: 1, held: 0 });
		expect(events.slice(1).every((event) => event.built === 0)).toBe(true);
	});
});
