// Shared body of the todos integration suite (constellation/doc/DOC-TESTING.md). The 12
// assertions run twice: once against the hand-written fixture
// (tests/todos-app.test.js) and once against the Go compiler's output
// (tests/todos-app-compiled.test.js). Both variants share this file so the
// compiled proof is byte-identical to the fixture proof — if a compiled test
// fails where the fixture passes, the codegen is wrong, not the test.
//
// Callers pass their module trio + a label; each entry test file must declare
// `// @vitest-environment jsdom` itself (the pragma is per-file, not importable).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PuzzleApp } from '../../client-runtime/index.js';
import installFakeAnimate from './fake-waapi.js';

// The live fake-WAAPI handle for the current test (set in beforeEach). jsdom has
// no Element.prototype.animate; the shared fake (tests/helpers/fake-waapi.js)
// makes the runtime's animation paths (enter on mount, deferred leave on remove)
// observable and controllable. Now that TodoItems declare `animations`, adding a
// row schedules an enter animation and deleting one DEFERS the row's removal
// until its leave animation finishes (viewManager unmount → destroyAnimated).
let waapi = null;

// ---- scheduling shims -------------------------------------------------------
// Store notifications are rAF-batched and setData re-renders are rAF-batched.
// settle() flushes both deterministically: store.flush() delivers pending record
// notifications synchronously (subscribed views re-run data()); the rAF ticks let
// any setData-scheduled renders run. Two rounds cover notifications queued during
// a render.
//
// ANIMATION-FINISHING STRATEGY (constellation/doc/DOC-SPEC.md §12, point 10):
// with the fake installed, enter/leave animations return DEFERRED finished
// promises — an added row's enter never auto-settles and a deleted row lingers in
// the DOM until its leave finishes. settle() therefore drives waapi.finishAll()
// on each round, right AFTER store.flush() has re-rendered (so a just-registered
// leave animation exists to finish) and again after the rAF has let async
// child mounts register their enter animation. This keeps the original 12
// assertions behaving as if animation were instant; the animation-specific tests
// below deliberately DON'T call settle so they can inspect a mid-flight animation
// before finishing it by hand.
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
async function settle(app) {
	app.store.flush();
	waapi?.finishAll();
	await raf();
	app.store.flush();
	waapi?.finishAll();
	await raf();
}

// Flush pending renders WITHOUT finishing animations — lets an async child mount
// land and register its enter animation, or a delete register its leave, so a
// test can assert on the mid-flight animation before finishing it.
async function flushRenders(app) {
	app.store.flush();
	await raf();
	app.store.flush();
	await raf();
}

// ---- an in-memory Storage-like object (hand-rolled, not localStorage) -------
function makeStorage(seed = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		clear: () => map.clear(),
		get _map() {
			return map;
		},
	};
}

// ---- DOM helpers: query the app the way a user sees it -----------------------
const rows = (el) => [...el.querySelectorAll('.max-h-96 > div')];
const rowText = (r) => r.querySelector('span.flex-1').textContent.trim();
const rowByText = (el, txt) => rows(el).find((r) => rowText(r) === txt);
const texts = (el) => rows(el).map(rowText);
const input = (el) => el.querySelector('input[type="text"]');

function stats(el) {
	const nums = [...el.querySelectorAll('.text-2xl')].map((n) => Number(n.textContent.trim()));
	return { active: nums[0], completed: nums[1], total: nums[2] };
}

// Type into the box and submit. A frame is awaited between the input event and
// the submit — exactly as in real use, where the two-way-bound render runs
// before the user clicks submit; this keeps the input vnode's tracked value in
// sync so the post-add clear is a real diff, not a stale-DOM no-op.
async function typeAndSubmit(el, text) {
	const box = input(el);
	box.value = text;
	box.dispatchEvent(new Event('input', { bubbles: true }));
	await raf();
	el.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function clickCheckbox(el, text) {
	rowByText(el, text)
		.querySelector('input[type="checkbox"]')
		.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickDelete(el, text) {
	rowByText(el, text)
		.querySelector('button[title="Delete todo"]')
		.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function clickButton(el, label) {
	const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
	btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function clickButtonStartsWith(el, prefix) {
	const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(prefix));
	btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

// runTodosSuite registers the full suite for one module trio. `label`
// disambiguates the describe titles between the fixture and compiled variants.
export function runTodosSuite({ TodoHome, DefaultLayout, Todo, label }) {
	// ---- app harness --------------------------------------------------------
	let apps = [];
	function boot({ storage, apiURL } = {}) {
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		const config = {
			target: el,
			routes: [
				{ path: '/', name: 'home', view: TodoHome, layout: DefaultLayout, meta: { title: 'Puzzle Todos' } },
			],
			models: { todo: Todo },
		};
		if (storage !== undefined) config.storage = storage;
		if (apiURL !== undefined) config.apiURL = apiURL;
		const app = new PuzzleApp(config);
		apps.push(app);
		return { app, el };
	}

	beforeEach(() => {
		history.replaceState({}, '', '/');
		document.body.innerHTML = '';
		document.title = '';
		// deleteTodo / clearCompleted gate on confirm(); jsdom doesn't implement it.
		vi.stubGlobal('confirm', () => true);
		// mounted() logs; keep test output clean.
		vi.spyOn(console, 'log').mockImplementation(() => {});
		// Install the shared fake WAAPI so the runtime's animation paths run
		// (jsdom has no Element.prototype.animate). settle() finishes animations so
		// the behavioural assertions stay timing-stable.
		waapi = installFakeAnimate();
	});

	afterEach(() => {
		apps.forEach((a) => a.unmount());
		apps = [];
		waapi?.finishAll(); // release any leave animations still deferring a removal
		waapi?.uninstall();
		waapi = null;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	describe(`Todos app [${label}] — add`, () => {
		it('typing + submitting adds a todo to the list and clears the input', async () => {
			const { app, el } = boot();
			await app.mount();
			expect(rows(el)).toHaveLength(0);

			await typeAndSubmit(el, 'buy milk');
			await settle(app);

			expect(texts(el)).toEqual(['buy milk']);
			expect(input(el).value).toBe(''); // input cleared after add
			expect(stats(el)).toEqual({ active: 1, completed: 0, total: 1 });
		});

		it('the empty submit is ignored (blank text creates nothing)', async () => {
			const { app, el } = boot();
			await app.mount();

			await typeAndSubmit(el, '   '); // whitespace only
			await settle(app);

			expect(rows(el)).toHaveLength(0);
			expect(el.textContent).toContain('Nothing here yet');
		});

		it('special characters display literally — text vnodes need no HTML escaping (D17)', async () => {
			const { app, el } = boot();
			await app.mount();

			await typeAndSubmit(el, 'a & b <i>not markup</i>');
			await settle(app);

			// createTextNode inserts literal text: the user sees exactly what they
			// typed (no &amp; double-encode), and the markup is inert (no <i> element).
			expect(texts(el)).toEqual(['a & b <i>not markup</i>']);
			expect(el.querySelector('i')).toBeNull();
		});
	});

	describe(`Todos app [${label}] — toggle`, () => {
		it('clicking a checkbox marks the row completed (strikethrough) and updates the stats', async () => {
			const { app, el } = boot();
			await app.mount();

			await typeAndSubmit(el, 'write tests');
			await settle(app);
			expect(stats(el)).toEqual({ active: 1, completed: 0, total: 1 });

			clickCheckbox(el, 'write tests');
			await settle(app);

			const row = rowByText(el, 'write tests');
			expect(row.querySelector('span.flex-1').className).toContain('line-through');
			// Redesigned completed indicator: the checkmark <svg> renders only under
			// {#if todo.completed} (the old row-level opacity-60 was removed).
			expect(row.querySelector('svg')).not.toBeNull();
			expect(row.querySelector('input[type="checkbox"]').checked).toBe(true);
			expect(stats(el)).toEqual({ active: 0, completed: 1, total: 1 });

			// toggling back clears the completed styling
			clickCheckbox(el, 'write tests');
			await settle(app);
			const back = rowByText(el, 'write tests');
			expect(back.querySelector('span.flex-1').className).not.toContain('line-through');
			expect(back.querySelector('svg')).toBeNull(); // checkmark gone when active
			expect(stats(el)).toEqual({ active: 1, completed: 0, total: 1 });
		});
	});

	describe(`Todos app [${label}] — filter tabs`, () => {
		it('narrows the list to Active / Completed / All', async () => {
			const { app, el } = boot();
			await app.mount();

			await typeAndSubmit(el, 'A');
			await settle(app);
			await typeAndSubmit(el, 'B');
			await settle(app);
			clickCheckbox(el, 'B'); // B completed
			await settle(app);

			clickButton(el, 'Active');
			await settle(app);
			expect(texts(el)).toEqual(['A']);

			clickButton(el, 'Completed');
			await settle(app);
			expect(texts(el)).toEqual(['B']);

			clickButton(el, 'All');
			await settle(app);
			expect(texts(el).sort()).toEqual(['A', 'B']);
		});

		it('keyed reconciliation preserves a surviving row DOM node across a filter change', async () => {
			const { app, el } = boot();
			await app.mount();

			await typeAndSubmit(el, 'keep-me');
			await settle(app);
			await typeAndSubmit(el, 'complete-me');
			await settle(app);
			clickCheckbox(el, 'complete-me'); // now completed; will be filtered out by Active
			await settle(app);

			const keepNode = rowByText(el, 'keep-me'); // grab the live DOM node under All
			expect(texts(el).sort()).toEqual(['complete-me', 'keep-me']);

			clickButton(el, 'Active');
			await settle(app);

			expect(texts(el)).toEqual(['keep-me']); // list narrowed
			expect(rowByText(el, 'keep-me')).toBe(keepNode); // same node identity (keyed, not re-created)
		});
	});

	describe(`Todos app [${label}] — delete`, () => {
		it('clicking a row delete button removes it and updates the counts', async () => {
			const { app, el } = boot();
			await app.mount();

			await typeAndSubmit(el, 'first');
			await settle(app);
			await typeAndSubmit(el, 'second');
			await settle(app);
			expect(stats(el)).toEqual({ active: 2, completed: 0, total: 2 });

			clickDelete(el, 'first');
			await settle(app);

			expect(texts(el)).toEqual(['second']);
			expect(stats(el)).toEqual({ active: 1, completed: 0, total: 1 });
		});
	});

	describe(`Todos app [${label}] — clear completed`, () => {
		it('removes every completed row, leaving the active ones', async () => {
			const { app, el } = boot();
			await app.mount();

			for (const t of ['a', 'b', 'c']) {
				await typeAndSubmit(el, t);
				await settle(app);
			}
			clickCheckbox(el, 'a');
			await settle(app);
			clickCheckbox(el, 'c');
			await settle(app);
			expect(stats(el)).toEqual({ active: 1, completed: 2, total: 3 });

			clickButtonStartsWith(el, 'Clear completed');
			await settle(app);

			expect(texts(el)).toEqual(['b']);
			expect(stats(el)).toEqual({ active: 1, completed: 0, total: 1 });
		});
	});

	describe(`Todos app [${label}] — empty state`, () => {
		it('shows the empty-state markup with no todos and hides it after the first add', async () => {
			const { app, el } = boot();
			await app.mount();

			expect(el.querySelector('.py-16')).not.toBeNull();
			expect(el.textContent).toContain('Nothing here yet');
			expect(el.textContent).toContain('Add your first todo above to get started.');

			await typeAndSubmit(el, 'something');
			await settle(app);

			expect(el.querySelector('.py-16')).toBeNull();
			expect(el.textContent).not.toContain('Nothing here yet');
			expect(texts(el)).toEqual(['something']);
		});
	});

	describe(`Todos app [${label}] — persistence round-trip`, () => {
		it('serializes records into the injected storage and a fresh app rehydrates them', async () => {
			const storage = makeStorage();
			const { app, el } = boot({ storage });
			await app.mount();

			await typeAndSubmit(el, 'persisted one');
			await settle(app);
			await typeAndSubmit(el, 'persisted two');
			await settle(app);
			clickCheckbox(el, 'persisted two');
			await settle(app);

			// storage holds the serialized records
			const saved = JSON.parse(storage.getItem('puzzle-store'));
			expect(saved.todo).toHaveLength(2);
			expect(saved.todo.map((t) => t.text).sort()).toEqual(['persisted one', 'persisted two']);
			expect(saved.todo.find((t) => t.text === 'persisted two').completed).toBe(true);

			// a SECOND app booted on the same storage shows the same todos
			const { app: app2, el: el2 } = boot({ storage });
			await app2.mount();

			expect(texts(el2).sort()).toEqual(['persisted one', 'persisted two']);
			expect(stats(el2)).toEqual({ active: 1, completed: 1, total: 2 });
			expect(rowByText(el2, 'persisted two').querySelector('span.flex-1').className).toContain(
				'line-through'
			);
		});
	});

	describe(`Todos app [${label}] — server load (D21 read path)`, () => {
		it('loadAll populates the list from fetch and a second load does not duplicate rows (upsert)', async () => {
			const payload = [
				{ id: 's1', text: 'server one', completed: false },
				{ id: 's2', text: 'server two', completed: true },
			];
			const fetchMock = vi.fn(async () => ({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => payload,
			}));
			vi.stubGlobal('fetch', fetchMock);

			const { app, el } = boot({ apiURL: 'https://api.test' });
			await app.mount();
			expect(el.textContent).toContain('Nothing here yet');

			await app.store.loadAll('todo');
			await settle(app);

			expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/todos');
			expect(texts(el).sort()).toEqual(['server one', 'server two']);
			expect(stats(el)).toEqual({ active: 1, completed: 1, total: 2 });

			// second load of the same payload upserts by id — no duplicate rows
			await app.store.loadAll('todo');
			await settle(app);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(rows(el)).toHaveLength(2);
			expect(texts(el).sort()).toEqual(['server one', 'server two']);
		});
	});

	describe(`Todos app [${label}] — update-cycle endurance (no render freeze)`, () => {
		it('stays correct across many sequential add/toggle/delete cycles', async () => {
			const { app, el } = boot();
			await app.mount();

			// 1..6: six adds, asserting the DOM grows each time (the prototype froze
			// after ~2 renders — this loop is the regression guard).
			const added = [];
			for (let i = 1; i <= 6; i++) {
				const label = 'task-' + i;
				await typeAndSubmit(el, label);
				await settle(app);
				added.push(label);
				expect(rows(el)).toHaveLength(i);
				expect(rowText(rows(el)[i - 1])).toBe(label); // newest appended
				expect(stats(el).total).toBe(i);
			}

			// toggle three complete
			for (const label of ['task-1', 'task-2', 'task-3']) {
				clickCheckbox(el, label);
				await settle(app);
			}
			expect(stats(el)).toEqual({ active: 3, completed: 3, total: 6 });
			for (const label of ['task-1', 'task-2', 'task-3']) {
				expect(rowByText(el, label).querySelector('span.flex-1').className).toContain('line-through');
			}

			// delete two
			clickDelete(el, 'task-1');
			await settle(app);
			clickDelete(el, 'task-4');
			await settle(app);
			expect(rows(el)).toHaveLength(4);
			expect(texts(el)).toEqual(['task-2', 'task-3', 'task-5', 'task-6']);
			expect(stats(el)).toEqual({ active: 2, completed: 2, total: 4 });

			// two more adds land correctly after all the churn
			await typeAndSubmit(el, 'task-7');
			await settle(app);
			await typeAndSubmit(el, 'task-8');
			await settle(app);
			expect(rows(el)).toHaveLength(6);
			expect(texts(el)).toEqual(['task-2', 'task-3', 'task-5', 'task-6', 'task-7', 'task-8']);
			expect(stats(el)).toEqual({ active: 4, completed: 2, total: 6 });

			// final integrity: toggling task-8 flips exactly one count each way
			clickCheckbox(el, 'task-8');
			await settle(app);
			expect(stats(el)).toEqual({ active: 3, completed: 3, total: 6 });
		});
	});

	// ---- TodoItem enter/leave animations (constellation/doc/DOC-SPEC.md §12) --
	// These assert the composition proof: rows are real components whose
	// `animations` field drives WAAPI enter/leave through the runtime. The fake is
	// installed for every test (beforeEach); here we inspect a mid-flight
	// animation before finishing it, so these tests avoid settle() (which would
	// auto-finish). The `.slice(before)` filters to animations created by the
	// action under test (app.mount() already ran the Home view's own fade-in).
	const enterOf = (list) => list.find((a) => a.keyframes?.[0]?.height === '0px');
	const leaveOf = (list) => list.find((a) => a.keyframes?.[1]?.height === '0px');

	describe(`Todos app [${label}] — item animations`, () => {
		it('adding a todo plays an enter animation on the new row', async () => {
			const { app, el } = boot();
			await app.mount();
			await settle(app); // finish the Home view's own fade-in first

			const before = waapi.animations.length;
			await typeAndSubmit(el, 'slide in');
			await flushRenders(app); // mount the child + register its enter (no finish)

			const enter = enterOf(waapi.animations.slice(before));
			expect(enter).toBeTruthy();
			// the declared enter keyframes/options reached WAAPI verbatim
			expect(enter.keyframes[0]).toMatchObject({ height: '0px', opacity: 0, transform: 'scale(0.9)' });
			// release contract: enter `to` equals the row's natural styled state (65px)
			expect(enter.keyframes[1]).toMatchObject({ height: '65px', opacity: 1, transform: 'scale(1)' });
			expect(enter.options).toMatchObject({ duration: 220, easing: 'ease-out' });

			// the row is in the DOM and stays after the animation settles
			expect(texts(el)).toContain('slide in');
			enter.finish();
			await raf();
			expect(texts(el)).toContain('slide in');
		});

		it('deleting a todo plays the leave animation; the row stays in the DOM until finish()', async () => {
			const { app, el } = boot();
			await app.mount();
			// Two rows so the list (and its {#if todos.length > 0} branch) survives the
			// delete: the removed row is then a DIRECT keyed unmount of a component
			// vnode, which animates its leave (destroyAnimated). A component nested in
			// a removed ELEMENT subtree — e.g. deleting the last todo, collapsing the
			// whole list into the empty state — tears down instantly instead.
			await typeAndSubmit(el, 'fade out');
			await settle(app);
			await typeAndSubmit(el, 'stays put');
			await settle(app);
			expect(texts(el).sort()).toEqual(['fade out', 'stays put']);

			const before = waapi.animations.length;
			clickDelete(el, 'fade out');
			app.store.flush(); // deliver destroy → re-render → unmount → destroyAnimated → out registered

			const leave = leaveOf(waapi.animations.slice(before));
			expect(leave).toBeTruthy();
			expect(leave.keyframes[0]).toMatchObject({ height: '65px', opacity: 1, transform: 'scale(1)' });
			expect(leave.keyframes[1]).toMatchObject({ height: '0px', opacity: 0, transform: 'scale(0.9)' });
			expect(leave.options).toMatchObject({ duration: 180, easing: 'ease-in' });

			// deferred removal: the row is STILL in the DOM while the leave plays
			expect(rowByText(el, 'fade out')).toBeTruthy();

			leave.finish();
			await raf();
			await raf();
			// out finished → destroyAnimated's destroy() removed the node
			expect(rowByText(el, 'fade out')).toBeUndefined();
		});

		it('switching filters does not enter/leave surviving rows (instance preservation)', async () => {
			const { app, el } = boot();
			await app.mount();
			await typeAndSubmit(el, 'row-a');
			await settle(app);
			await typeAndSubmit(el, 'row-b');
			await settle(app);
			expect(texts(el).sort()).toEqual(['row-a', 'row-b']);

			// both rows are active, so All → Active → All keeps both visible the whole
			// time: keyed reconciliation reuses the same TodoItem instances (no
			// mount/unmount), so NO enter/leave animation fires for a surviving row.
			const before = waapi.animations.length;

			clickButton(el, 'Active');
			await settle(app);
			expect(texts(el).sort()).toEqual(['row-a', 'row-b']);

			clickButton(el, 'All');
			await settle(app);
			expect(texts(el).sort()).toEqual(['row-a', 'row-b']);

			expect(waapi.animations.length).toBe(before);
		});

		it('the enter animation is released after finishing (cancel — the fill handback)', async () => {
			const { app, el } = boot();
			await app.mount();
			await settle(app);

			const before = waapi.animations.length;
			await typeAndSubmit(el, 'release me');
			await flushRenders(app);

			const enter = enterOf(waapi.animations.slice(before));
			expect(enter).toBeTruthy();
			expect(enter.cancel).not.toHaveBeenCalled(); // still owns the element mid-flight

			enter.finish();
			await raf();
			// release: true → the completed enter is cancelled so the element returns
			// to stylesheet-driven state (animate.js release contract)
			expect(enter.cancel).toHaveBeenCalled();
		});
	});
}
