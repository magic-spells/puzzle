// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { installFakeAnimate } from './helpers/fake-waapi.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};

	toggle() {
		return this.update({ completed: !this.completed });
	}
}

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctxWith = (store) => ({ store, router: null, formatters: null });

/**
 * Wait past the animation frame #scheduleRender armed. The view's rAF callback was
 * registered first, so ours runs after it in the same frame batch; the trailing
 * setTimeout drains anything it queued.
 */
const afterFrame = () =>
	new Promise((resolve) => {
		const done = () => setTimeout(resolve, 0);
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
		else setTimeout(done, 0);
	});

describe('PuzzleView — lifecycle', () => {
	it('runs created → data → render → mounted, in order', async () => {
		const calls = [];
		class V extends PuzzleView {
			created() { calls.push('created'); }
			data() { calls.push('data'); return {}; }
			render() { calls.push('render'); return h('div', {}, [text('hi')]); }
			mounted() { calls.push('mounted'); }
		}
		const el = container();
		await new V().mount(el);
		expect(calls).toEqual(['created', 'data', 'render', 'mounted']);
		expect(el.textContent).toBe('hi');
	});

	it('data() receives params and props from mount', async () => {
		let seen;
		class V extends PuzzleView {
			data({ params, props }) { seen = { params, props }; return {}; }
		}
		await new V().mount(container(), { params: { id: '42' }, props: { userId: 7 } });
		expect(seen).toEqual({ params: { id: '42' }, props: { userId: 7 } });
	});

	it('setState in created() seeds state that data() reads back — the TodoHome pattern', async () => {
		class V extends PuzzleView {
			created() { this.setState({ currentFilter: 'all' }); }
			data() {
				const local = this.getData();
				return { filterLabel: `filter: ${local.currentFilter}` };
			}
			render() { return h('p', {}, [text(this.getData().filterLabel)]); }
		}
		const el = container();
		await new V().mount(el);
		expect(el.textContent).toBe('filter: all');
	});

	it('awaits async data() before first render and mounted()', async () => {
		let mountedAt;
		class V extends PuzzleView {
			async data() {
				await new Promise((r) => setTimeout(r, 5));
				return { msg: 'loaded' };
			}
			render() { return h('div', {}, [text(this.getData().msg)]); }
			mounted() { mountedAt = this.element.textContent; }
		}
		const el = container();
		await new V().mount(el);
		expect(el.textContent).toBe('loaded');
		expect(mountedAt).toBe('loaded'); // mounted() saw the rendered DOM
	});

	it('element getter exposes the root DOM node (used by mounted() focus code)', async () => {
		class V extends PuzzleView {
			render() { return h('form', {}, [h('input', { type: 'text' })]); }
			mounted() { this.element.querySelector('input').focus(); }
		}
		const el = container();
		await new V().mount(el);
		expect(document.activeElement).toBe(el.querySelector('input'));
	});

	it('destroy() clears DOM, fires destroyed(), and is idempotent', async () => {
		const destroyed = vi.fn();
		class V extends PuzzleView {
			render() { return h('div', {}, [text('x')]); }
			destroyed() { destroyed(); }
		}
		const el = container();
		const v = await new V().mount(el);
		v.destroy();
		v.destroy();
		expect(el.innerHTML).toBe('');
		expect(destroyed).toHaveBeenCalledTimes(1);
	});

	it('a parent prop update superseding the initial async data() defers mounted() to the landing commit (anchor-race gate, Change A)', async () => {
		// mount()'s non-skeleton async branch awaits the token-1 refresh. A parent
		// prop update during that await calls refresh({props}) → bumps #runToken, so
		// the token-1 #commit is superseded and skips its render — no first render has
		// committed and this.element is still the comment anchor. mounted() must NOT
		// fire against the anchor; it defers to the token-2 commit that DOES render.
		const mk = () => {
			let resolve;
			const promise = new Promise((r) => { resolve = r; });
			return { promise, resolve };
		};
		const gates = { one: mk(), two: mk() };
		let mountedEl;
		const mountedSpy = vi.fn();
		class V extends PuzzleView {
			async data({ props }) {
				const { val } = await gates[props.which ?? 'one'].promise;
				return { val };
			}
			render() { return h('div', { class: 'v' }, [text(this.getData().val ?? '')]); }
			mounted() { mountedSpy(); mountedEl = this.element; }
		}
		const el = container();
		const v = new V();
		const mountPromise = v.mount(el, { props: { which: 'one' } }); // token 1 in flight

		v.applyParentUpdate({ props: { which: 'two' } }); // token 2 supersedes token 1

		// Token-1 resolves first: its commit is superseded → no render, no mounted().
		gates.one.resolve({ val: 'stale' });
		await gates.one.promise;
		await Promise.resolve();
		await mountPromise; // mount settles; mounted() still deferred
		expect(mountedSpy).not.toHaveBeenCalled();
		expect(el.querySelector('.v')).toBeNull(); // only the anchor so far

		// Token-2 lands: first real render → deferred mounted() fires exactly once,
		// against a real element (not the comment anchor).
		gates.two.resolve({ val: 'fresh' });
		await gates.two.promise;
		await Promise.resolve();
		await Promise.resolve();

		expect(el.querySelector('.v').textContent).toBe('fresh');
		expect(mountedSpy).toHaveBeenCalledTimes(1);
		expect(mountedEl).toBeInstanceOf(Element);
		expect(mountedEl.textContent).toBe('fresh');
	});

	it('a nested superseded async mount enters only after mounted(), on the real root', async () => {
		const waapi = installFakeAnimate();
		const deferred = () => {
			let resolve;
			const promise = new Promise((r) => {
				resolve = r;
			});
			return { promise, resolve };
		};
		const gates = { one: deferred(), two: deferred() };
		const order = [];
		const mounted = vi.fn((el) => order.push(['mounted', el]));
		const willShow = vi.fn((el) => order.push(['viewWillShow', el]));
		const didShow = vi.fn((el) => order.push(['viewDidShow', el]));
		const instances = [];

		class Child extends PuzzleView {
			animations = {
				in: {
					from: { opacity: 0 },
					to: { opacity: 1 },
					duration: 100,
				},
			};
			constructor(...args) {
				super(...args);
				instances.push(this);
			}
			async data({ props }) {
				const value = await gates[props.which].promise;
				return { value };
			}
			mounted() {
				mounted(this.element);
			}
			viewWillShow() {
				willShow(this.element);
			}
			viewDidShow() {
				didShow(this.element);
			}
			render() {
				return h('span', { class: 'async-child' }, [text(this.getData().value)]);
			}
		}
		class Host extends PuzzleView {
			created() {
				this.setState('which', 'one');
			}
			render() {
				return h('section', {}, [comp(Child, { which: this.getData().which })]);
			}
		}

		try {
			const el = container();
			const host = await new Host().mount(el);
			host.setState('which', 'two');
			host.flushUpdates();

			gates.one.resolve('stale');
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			expect(order).toEqual([]);
			expect(waapi.animations).toHaveLength(0);

			gates.two.resolve('fresh');
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			const root = el.querySelector('.async-child');
			expect(root.textContent).toBe('fresh');
			expect(order).toEqual([
				['mounted', root],
				['viewWillShow', root],
			]);
			expect(mounted).toHaveBeenCalledTimes(1);
			expect(willShow).toHaveBeenCalledTimes(1);
			expect(didShow).not.toHaveBeenCalled();
			expect(waapi.animations).toHaveLength(1);
			expect(waapi.animations[0].target).toBe(root);
			expect(instances).toHaveLength(1);

			waapi.finishAll();
			await Promise.resolve();
			await Promise.resolve();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(order).toEqual([
				['mounted', root],
				['viewWillShow', root],
				['viewDidShow', root],
			]);
		} finally {
			waapi.uninstall();
		}
	});

	it('destroy() during async data() suppresses mounted() but still fires destroyed()', async () => {
		const mounted = vi.fn();
		const destroyed = vi.fn();
		class V extends PuzzleView {
			async data() {
				await new Promise((r) => setTimeout(r, 5));
				return { msg: 'loaded' };
			}
			render() { return h('div', {}, [text(this.getData().msg)]); }
			mounted() { mounted(); }
			destroyed() { destroyed(); }
		}
		const el = container();
		const v = new V();
		const mountPromise = v.mount(el); // async data() in flight
		v.destroy(); // tear down before data resolves
		await expect(mountPromise).resolves.toBe(v); // mount settles without throwing
		expect(mounted).not.toHaveBeenCalled(); // destroyed instance never mounts
		expect(destroyed).toHaveBeenCalledTimes(1);
	});
});

describe('PuzzleView — afterUpdate(prev) (D178)', () => {
	// `prev` is what the PREVIOUS render drew — frozen, shallow — not whatever the
	// instance held when the update started: setState writes #data at call time and
	// refresh swaps props/params/route before data() runs.

	it('setState: prev.data is the drawn state, frozen and separate from the live data', async () => {
		const seen = [];
		class V extends PuzzleView {
			data() { return { label: 'model' }; }
			afterUpdate(prev) { seen.push({ prev, now: this.getData() }); }
			render() { return h('p', {}, [text(`${this.getData().label}:${this.getData().count ?? 0}`)]); }
		}
		const props = { tone: 'calm' };
		const v = await new V().mount(container(), { props });

		v.setState('count', 1);
		v.flushUpdates();
		v.setState('count', 2);
		v.flushUpdates();

		expect(seen).toHaveLength(2);
		expect(seen[0].prev.data).toEqual({ label: 'model' });
		expect(seen[0].now.count).toBe(1);
		expect(seen[1].prev.data).toEqual({ label: 'model', count: 1 });
		expect(seen[1].now.count).toBe(2);

		const { prev } = seen[1];
		expect(Object.isFrozen(prev)).toBe(true);
		expect(Object.isFrozen(prev.data)).toBe(true);
		expect(() => { prev.data.count = 99; }).toThrow(TypeError);
		expect(() => { prev.extra = 1; }).toThrow(TypeError);
		expect(v.getData().count).toBe(2); // the copy is not the live layer
		// Props are referenced, never copied or frozen.
		expect(prev.props).toBe(props);
		expect(Object.isFrozen(props)).toBe(false);
		expect(Object.keys(prev).sort()).toEqual(['data', 'params', 'props', 'route']);
	});

	it('refresh(): prev.data is the previous data() commit', async () => {
		let source = 'a';
		const seen = [];
		class V extends PuzzleView {
			data() { return { value: source }; }
			afterUpdate(prev) { seen.push([prev.data.value, this.getData().value]); }
			render() { return h('p', {}, [text(this.getData().value)]); }
		}
		const v = await new V().mount(container());
		source = 'b';
		v.refresh();
		source = 'c';
		v.refresh();
		expect(seen).toEqual([['a', 'b'], ['b', 'c']]);
	});

	it('an async refresh({ props }) hands the props of the last render, not those refresh swapped in', async () => {
		const seen = [];
		class V extends PuzzleView {
			async data({ props }) {
				await Promise.resolve();
				return { n: props.n };
			}
			afterUpdate(prev) { seen.push({ prevN: prev.props.n, nowN: this.props.n, prevData: prev.data.n }); }
			render() { return h('p', {}, [text(String(this.getData().n))]); }
		}
		const v = await new V().mount(container(), { props: { n: 1 } });
		const pending = v.refresh({ props: { n: 2 } });
		expect(v.props.n).toBe(2); // already swapped, but not yet drawn
		await pending;
		expect(seen).toEqual([{ prevN: 1, nowN: 2, prevData: 1 }]);
	});

	it('parent-driven prop change: prev.props is the object the previous render received', async () => {
		const seen = [];
		class Child extends PuzzleView {
			data({ props }) { return { doubled: props.n * 2 }; }
			afterUpdate(prev) { seen.push({ prev, props: this.props, data: this.getData() }); }
			render() { return h('span', {}, [text(String(this.getData().doubled))]); }
		}
		class Parent extends PuzzleView {
			created() { this.setState('n', 1); }
			render() { return h('div', {}, [comp(Child, { n: this.getData().n })]); }
		}
		const el = container();
		const parent = await new Parent().mount(el);
		parent.setState('n', 5);
		parent.flushUpdates();

		expect(el.textContent).toBe('10');
		expect(seen).toHaveLength(1);
		const [{ prev, props, data }] = seen;
		expect(prev.props.n).toBe(1);
		expect(props.n).toBe(5);
		expect(prev.props).not.toBe(props);
		expect(prev.data.doubled).toBe(2);
		expect(data.doubled).toBe(10);
	});

	it('store notification: prev.data holds the pre-change derived values; the record keeps identity', async () => {
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 't1', text: 'first' });
		const seen = [];
		class V extends PuzzleView {
			data() {
				const todo = this.ctx.store.findOne('todo', 't1');
				return { todo, text: todo.text };
			}
			afterUpdate(prev) { seen.push({ prev, now: this.getData() }); }
			render() { return h('p', {}, [text(this.getData().text)]); }
		}
		await new V(ctxWith(store)).mount(container());

		store.findOne('todo', 't1').update({ text: 'second' });
		store.flush();

		expect(seen).toHaveLength(1);
		const [{ prev, now }] = seen;
		expect(prev.data.text).toBe('first');
		expect(now.text).toBe('second');
		// D170: the same record, so identity alone does not show an edit.
		expect(prev.data.todo).toBe(now.todo);
	});

	it('a view without the hook takes no snapshot', async () => {
		class Plain extends PuzzleView {
			render() { return h('p', {}, [text(String(this.getData().n ?? 0))]); }
		}
		class Hooked extends Plain {
			afterUpdate() {}
		}
		const plain = await new Plain().mount(container());
		const hooked = await new Hooked().mount(container());
		// The snapshot is the only freeze of a { props, params, route, data } object
		// (the dev profiler freezes its own render records, so count by shape).
		const freeze = vi.spyOn(Object, 'freeze');
		const snapshots = () =>
			freeze.mock.calls.filter(([o]) => o && typeof o === 'object' && 'props' in o && 'data' in o && 'route' in o)
				.length;
		try {
			plain.setState('n', 1);
			plain.flushUpdates();
			expect(snapshots()).toBe(0);

			hooked.setState('n', 1);
			hooked.flushUpdates();
			expect(snapshots()).toBe(1); // the hooked control does snapshot
		} finally {
			freeze.mockRestore();
		}
	});

	it('an afterUpdate() override with no parameter still fires once per update', async () => {
		const calls = [];
		class V extends PuzzleView {
			afterUpdate() { calls.push(arguments.length); }
			render() { return h('p', {}, [text(String(this.getData().n ?? 0))]); }
		}
		const v = await new V().mount(container());
		expect(calls).toEqual([]); // not on the first render
		v.setState('n', 1);
		v.flushUpdates();
		expect(calls).toEqual([1]);
	});
});

describe('PuzzleView — setState semantics (SPEC §4)', () => {
	class Counter extends PuzzleView {
		data() { return { count: this.getData().count ?? 0 }; }
		render() { return h('span', {}, [text(`count: ${this.getData().count}`)]); }
	}

	it('re-renders WITHOUT re-running data() for a key data() never read', async () => {
		class V extends PuzzleView {
			data() { return { label: 'fixed' }; }
			render() { return h('span', {}, [text(`${this.getData().label} ${this.getData().count ?? 0}`)]); }
		}
		const v = new V();
		const dataSpy = vi.spyOn(v, 'data');
		const el = container();
		await v.mount(el);
		expect(dataSpy).toHaveBeenCalledTimes(1);

		v.setState('count', 5);
		v.flushUpdates();
		expect(el.textContent).toBe('fixed 5');
		expect(dataSpy).toHaveBeenCalledTimes(1); // still once
	});

	it('re-runs data() once with the render for a key data() read (D23)', async () => {
		const v = new Counter();
		const dataSpy = vi.spyOn(v, 'data');
		const el = container();
		await v.mount(el);
		expect(dataSpy).toHaveBeenCalledTimes(1);

		v.setState('count', 5);
		expect(dataSpy).toHaveBeenCalledTimes(1); // nothing runs until the flush
		v.flushUpdates();
		expect(el.textContent).toBe('count: 5');
		expect(dataSpy).toHaveBeenCalledTimes(2);
	});

	it('batches multiple setState calls into one render with beforeUpdate/afterUpdate around it', async () => {
		const hooks = [];
		class V extends Counter {
			beforeUpdate() { hooks.push('before'); }
			afterUpdate() { hooks.push('after'); }
		}
		const v = new V();
		const el = container();
		await v.mount(el);
		expect(hooks).toEqual([]); // hooks do not fire on initial render

		v.setState('count', 1);
		v.setState('count', 2);
		v.setState('count', 3);
		v.flushUpdates();
		expect(el.textContent).toBe('count: 3');
		expect(hooks).toEqual(['before', 'after']); // one update cycle
	});

	// #scheduleRender arms a rAF and sets #updateScheduled; only flushUpdates cleared
	// it. A synchronous refresh() in the same tick renders immediately, so the still
	// pending rAF fired a THIRD render with byte-identical state. Clearing the flag
	// wherever a render actually lands makes any render satisfy the pending one.
	it('a synchronous refresh() satisfies the render setState scheduled (no stale third pass)', async () => {
		const renders = [];
		class V extends PuzzleView {
			data() { return { n: this.getData().n ?? 0 }; }
			render() {
				renders.push(this.getData().n);
				return h('span', {}, [text(`n: ${this.getData().n}`)]);
			}
		}
		const v = new V();
		const el = container();
		await v.mount(el);
		expect(renders).toEqual([0]);

		v.setState('n', 1);
		expect(renders).toEqual([0]); // scheduled for the frame, not rendered yet
		v.refresh(); // sync data() → commits and renders right now
		expect(renders).toEqual([0, 1]);

		await afterFrame();
		expect(renders).toEqual([0, 1]); // the stale rAF must not re-render
		expect(el.textContent).toBe('n: 1');
	});

	it('a setState issued after that synchronous refresh still re-arms the frame', async () => {
		const renders = [];
		class V extends PuzzleView {
			data() { return { n: this.getData().n ?? 0 }; }
			render() {
				renders.push(this.getData().n);
				return h('span', {}, [text(`n: ${this.getData().n}`)]);
			}
		}
		const v = new V();
		const el = container();
		await v.mount(el);

		v.setState('n', 1);
		v.refresh();
		v.setState('n', 2); // same tick, after the sync render
		await afterFrame();
		expect(renders).toEqual([0, 1, 2]);
		expect(el.textContent).toBe('n: 2');
	});

	it('a throwing update is contained and replaced by the default recovery placeholder', async () => {
		let boom = true;
		class V extends Counter {
			beforeUpdate() { if (boom) { boom = false; throw new Error('boom'); } }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const v = new V();
		const el = container();
		await v.mount(el);

		v.setState('count', 1);
		v.flushUpdates(); // throws internally, reported, not rethrown
		expect(v.isDestroyed).toBe(true);
		expect(el.textContent).toBe('');
		expect(el.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
		errSpy.mockRestore();
	});
});

describe('PuzzleView — setState() re-runs data() when data() read the key (D23)', () => {
	// a filter tab narrowing a list: the classic derived-from-local-state shape
	class Filtered extends PuzzleView {
		created() { this.setState({ filter: 'all', draft: '' }); }
		data() {
			const { filter } = this.getData();
			const items = ['a1', 'b1', 'a2'];
			return { shown: filter === 'all' ? items : items.filter((i) => i.startsWith(filter)) };
		}
		render() { return h('p', {}, [text(`${this.getData().shown.join(',')}|${this.getData().draft}`)]); }
	}

	it('a derived value follows setState() with no refresh()', async () => {
		const v = new Filtered();
		const el = container();
		await v.mount(el);
		expect(el.textContent).toBe('a1,b1,a2|');
		v.setState('filter', 'a');
		await v.renderTick();
		expect(el.textContent).toBe('a1,a2|');
	});

	it('a burst of writes runs data() once and renders once', async () => {
		let renders = 0;
		class V extends Filtered {
			afterUpdate() { renders++; }
		}
		const v = new V();
		const el = container();
		await v.mount(el);
		const dataSpy = vi.spyOn(v, 'data');
		v.setState('filter', 'b');
		v.setState('filter', 'a');
		v.setState({ filter: 'a', draft: 'x' });
		await v.renderTick();
		expect(dataSpy).toHaveBeenCalledTimes(1);
		expect(renders).toBe(1);
		expect(el.textContent).toBe('a1,a2|x');
	});

	it('a key data() never read only re-renders', async () => {
		const v = new Filtered();
		const el = container();
		await v.mount(el);
		const dataSpy = vi.spyOn(v, 'data');
		v.setState('draft', 'typed');
		await v.renderTick();
		expect(dataSpy).not.toHaveBeenCalled();
		expect(el.textContent).toBe('a1,b1,a2|typed');
	});

	it('an explicit refresh() right after setState() still runs data() just once', async () => {
		const v = new Filtered();
		await v.mount(container());
		const dataSpy = vi.spyOn(v, 'data');
		v.setState('filter', 'a');
		v.refresh();
		await v.renderTick();
		expect(dataSpy).toHaveBeenCalledTimes(1);
	});

	it('reads through getState() count too', async () => {
		class V extends PuzzleView {
			data() { return { doubled: (this.getState().n ?? 0) * 2 }; }
			render() { return h('p', {}, [text(String(this.getData().doubled))]); }
		}
		const v = new V();
		const el = container();
		await v.mount(el);
		v.setState('n', 4);
		await v.renderTick();
		expect(el.textContent).toBe('8');
	});

	it('spreading getData() inside data() counts as reading every key, new ones included', async () => {
		class V extends PuzzleView {
			data() {
				const all = { ...this.getData() };
				return { count: Object.keys(all).filter((k) => k !== 'count').length };
			}
			render() { return h('p', {}, [text(String(this.getData().count))]); }
		}
		const v = new V();
		const el = container();
		await v.mount(el);
		expect(el.textContent).toBe('0');
		v.setState('fresh', true); // a key that did not exist when data() last ran
		await v.renderTick();
		expect(el.textContent).toBe('1');
	});

	it('a setState() inside data() does not schedule a re-run of itself', async () => {
		class V extends PuzzleView {
			data() {
				const n = this.getData().n ?? 0;
				this.setState('seen', n);
				return { label: `n=${n}` };
			}
			render() { return h('p', {}, [text(this.getData().label)]); }
		}
		const v = new V();
		await v.mount(container());
		const dataSpy = vi.spyOn(v, 'data');
		v.setState('n', 1);
		await v.renderTick();
		await v.renderTick();
		expect(dataSpy).toHaveBeenCalledTimes(1);
	});

	it('an async data() shows the written value at once, then the derived one when it resolves', async () => {
		/** @type {(v?: any) => void} */
		let release = () => {};
		class V extends PuzzleView {
			async data() {
				const q = this.getData().q ?? '';
				await new Promise((r) => (release = r));
				return { result: `results for ${q}` };
			}
			render() { return h('p', {}, [text(`${this.getData().q ?? ''}|${this.getData().result ?? ''}`)]); }
		}
		const v = new V();
		const el = container();
		const mounting = v.mount(el);
		release();
		await mounting;
		expect(el.textContent).toBe('|results for ');
		v.setState('q', 'cats');
		await v.renderTick();
		expect(el.textContent).toBe('cats|results for '); // the write is on screen right away
		release();
		await new Promise((r) => setTimeout(r, 0));
		expect(el.textContent).toBe('cats|results for cats');
	});

	// A render that lands before the flush but runs no data() must not swallow the re-run.
	it('a slotted child that tells its parent, then writes its own state, still re-runs data()', async () => {
		let runs = 0;
		let renders = 0;
		// an uncontrolled tab strip: it reports the pick, then moves its own highlight
		class Tabs extends PuzzleView {
			created() { this.setState('active', 'a'); }
			data() {
				runs++;
				const { active } = this.getState();
				return { marks: ['a', 'b'].map((id) => (id === active ? `[${id}]` : id)).join(' ') };
			}
			pick(id) {
				this.props.onPick(id);
				this.setState('active', id);
			}
			render() {
				renders++;
				return h('div', {}, [h('button', { '@click': () => this.pick('b') }, [text(this.getData().marks)]), h(SLOT_TAG)]);
			}
		}
		class Page extends PuzzleView {
			pick = (id) => this.setState('last', id);
			render() { return h('main', {}, [comp(Tabs, { onPick: this.pick }, [text(`panel ${this.getData().last ?? 'a'}`)])]); }
		}
		const el = container();
		await new Page().mount(el);
		runs = renders = 0;
		el.querySelector('button').click(); // the parent's frame is armed first, so it re-renders the tabs' slot
		await afterFrame();
		expect(el.textContent).toBe('a [b]panel b');
		expect(runs).toBe(1);
		expect(renders).toBe(2); // the parent's slot update, then the re-run's commit
	});

	it('an older async run that commits before the flush keeps the re-run for the newer write', async () => {
		const gates = [];
		let runs = 0;
		let renders = 0;
		class Search extends PuzzleView {
			async data() {
				runs++;
				const q = this.getState().q ?? '';
				await new Promise((r) => gates.push(r));
				return { result: `results for ${q}` };
			}
			render() {
				renders++;
				return h('p', {}, [text(`${this.getData().q ?? ''}|${this.getData().result}`)]);
			}
		}
		const v = new Search();
		const el = container();
		const mounting = v.mount(el);
		gates.shift()();
		await mounting;
		v.setState('q', 'c');
		await v.renderTick(); // the run for "c" is in flight
		runs = renders = 0;
		v.setState('q', 'ca'); // the next keystroke arms a flush…
		gates.shift()(); // …and the response for "c" lands before it
		await afterFrame();
		gates.splice(0).forEach((r) => r());
		await new Promise((r) => setTimeout(r, 0));
		expect(el.textContent).toBe('ca|results for ca');
		expect(runs).toBe(1);
		expect(renders).toBe(3); // the "c" commit, the flush while "ca" runs, the "ca" commit
	});

	it('a re-run flagged before mount never claims a frame nobody armed', async () => {
		class V extends PuzzleView {
			data() { return { doubled: (this.getState().n ?? 0) * 2 }; }
			render() { return h('p', {}, [text(`${this.getData().n ?? 0}|${this.getData().doubled}`)]); }
		}
		const v = new V();
		await v.preload();
		v.setState('n', 1); // not mounted yet: the re-run is flagged, no frame is armed
		const el = container();
		await v.mount(el, { preloaded: true });
		v.setState('n', 2);
		await afterFrame();
		expect(el.textContent).toBe('2|4');
	});

	it('a sync data() throw on the re-run is contained, not rethrown from the flush', async () => {
		class V extends PuzzleView {
			data() {
				if (this.getData().boom) throw new Error('boom');
				return { ok: true };
			}
			render() { return h('p', {}, [text('ok')]); }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const v = new V();
		await v.mount(container());
		v.setState('boom', true);
		expect(() => v.flushUpdates()).not.toThrow();
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});
});

describe('PuzzleView — two-layer data()/setState semantics (Change C, SPEC §4)', () => {
	// #state (setState) and #derived (last successful data(), replaced wholesale) compose
	// into the visible getData(): the model overlays local (a data() commit beats an
	// EARLIER setState); a LATER setState beats the model value until the next commit.
	const mkGate = () => {
		let resolve, reject;
		const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
		return { promise, resolve, reject };
	};
	const makeView = (modelFn) => {
		class V extends PuzzleView {
			data() { return modelFn(); }
			render() { return h('span', {}, [text(JSON.stringify(this.getData()))]); }
		}
		return new V();
	};

	it('1. a key from data() run N, omitted by run N+1, disappears — unless local has it', async () => {
		let phase = 1;
		const v = makeView(() => (phase === 1 ? { a: 1, b: 2 } : { a: 1 }));
		await v.mount(container());
		expect(v.getData()).toEqual({ a: 1, b: 2 });

		phase = 2;
		v.refresh(); // model replaced wholesale — b is gone
		expect(v.getData()).toEqual({ a: 1 });

		// A LOCAL b, however, survives the model omission.
		phase = 1; v.refresh();
		v.setState('b', 99);
		phase = 2; v.refresh();
		expect(v.getData().b).toBe(99);
	});

	it('2. local setState state survives data() re-runs when the model omits the key', async () => {
		const v = makeView(() => ({ n: 1 }));
		await v.mount(container());
		v.setState('draft', 'hello');
		expect(v.getData()).toEqual({ n: 1, draft: 'hello' });
		v.refresh(); // model still { n: 1 } — no draft
		expect(v.getData().draft).toBe('hello');
	});

	it('3. a data() commit overwrites an earlier setState value for the same key', async () => {
		let val = 'model-A';
		const v = makeView(() => ({ x: val }));
		await v.mount(container());
		v.setState('x', 'local-override');
		expect(v.getData().x).toBe('local-override'); // later setState wins for now
		val = 'model-B';
		v.refresh();
		expect(v.getData().x).toBe('model-B'); // the commit beats the earlier setState
	});

	it('4. a later setState overwrites the model value until the next commit', async () => {
		const v = makeView(() => ({ x: 'from-model' }));
		await v.mount(container());
		expect(v.getData().x).toBe('from-model');
		v.setState('x', 'from-local');
		expect(v.getData().x).toBe('from-local'); // wins until the next commit
		v.refresh();
		expect(v.getData().x).toBe('from-model'); // the next commit re-asserts the model
	});

	it('5. created()-seeded setState is readable in the first data() (getData inside data)', async () => {
		let seen;
		class V extends PuzzleView {
			created() { this.setState({ seed: 'seeded' }); }
			data() { seen = this.getData().seed; return { echoed: this.getData().seed }; }
			render() { return h('span', {}, [text(this.getData().echoed ?? '')]); }
		}
		const v = new V();
		await v.mount(container());
		expect(seen).toBe('seeded');
		expect(v.getData()).toEqual({ seed: 'seeded', echoed: 'seeded' });
	});

	it('5b. getState() returns the state layer alone, as a copy (D191)', async () => {
		const v = makeView(() => ({ x: 'from-model', total: 3 }));
		await v.mount(container());
		v.setState({ x: 'from-local', draft: 'hi' });
		// the state layer holds only what setState wrote; data()'s keys stay out
		expect(v.getState()).toEqual({ x: 'from-local', draft: 'hi' });
		v.refresh();
		// after the commit the merged view shows the model's x, the state layer keeps its own
		expect(v.getData().x).toBe('from-model');
		expect(v.getState().x).toBe('from-local');
		// a copy: mutating it never reaches the view
		const copy = v.getState();
		copy.draft = 'changed';
		expect(v.getState().draft).toBe('hi');
		// the old name is gone outright, with no alias
		expect(/** @type {any} */ (v).setData).toBeUndefined();
	});

	it('6. a superseded stale-token data() run touches neither layer', async () => {
		const slow = mkGate();
		class V extends PuzzleView {
			async data({ props }) {
				if (props.tag === 'slow') { await slow.promise; return { stale: true, val: 'slow' }; }
				return { val: 'fast' };
			}
			render() { return h('span', {}, [text(this.getData().val ?? '')]); }
		}
		const v = new V();
		await v.mount(container(), { props: { tag: 'init' } });

		const slowRun = v.refresh({ props: { tag: 'slow' } }); // token N, suspended
		const fastRun = v.refresh({ props: { tag: 'fast' } }); // token N+1, resolves now
		await fastRun;
		expect(v.getData()).toEqual({ val: 'fast' });

		slow.resolve();
		await slowRun;
		expect(v.getData()).toEqual({ val: 'fast' }); // stale result never landed
		expect('stale' in v.getData()).toBe(false); // neither layer touched
	});

	it('6b. a rejected data() run touches neither layer', async () => {
		let boom = false;
		class V extends PuzzleView {
			async data() { if (boom) throw new Error('boom'); return { ok: 1 }; }
			render() { return h('span', {}, []); }
		}
		const v = new V();
		await v.mount(container());
		expect(v.getData()).toEqual({ ok: 1 });
		boom = true;
		await expect(v.refresh()).rejects.toThrow('boom');
		expect(v.getData()).toEqual({ ok: 1 }); // unchanged
	});

	it('7. getData() returns a fresh shallow copy each call', async () => {
		const v = makeView(() => ({ a: 1 }));
		await v.mount(container());
		const a = v.getData();
		const b = v.getData();
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
		a.a = 999; // mutating the copy must not leak back into the view's state
		expect(v.getData().a).toBe(1);
	});
});

describe('PuzzleView — store reactivity (the full loop)', () => {
	class TodoList extends PuzzleView {
		data() {
			const todos = this.ctx.store.findMany('todo');
			return { todos, active: todos.filter((t) => !t.completed).length };
		}
		render() {
			const { todos, active } = this.getData();
			return h('ul', { 'data-active': active }, todos.map((t) =>
				h('li', { key: t.id }, [text(t.text + (t.completed ? ' ✓' : ''))])
			));
		}
	}

	it('store changes re-run data() and patch the DOM', async () => {
		const store = new Store({ todo: Todo });
		const el = container();
		const v = await new TodoList(ctxWith(store)).mount(el);

		store.createRecord('todo', { id: 't1', text: 'write tests' });
		store.flush();
		expect(el.querySelectorAll('li')).toHaveLength(1);

		const t1 = store.findOne('todo', 't1');
		t1.toggle();
		store.flush();
		expect(el.textContent).toBe('write tests ✓');
		expect(el.querySelector('ul').getAttribute('data-active')).toBe('0');

		t1.destroy();
		store.flush();
		expect(el.querySelectorAll('li')).toHaveLength(0);
	});

	it('destroyed components stop reacting to store changes', async () => {
		const store = new Store({ todo: Todo });
		const el = container();
		const v = await new TodoList(ctxWith(store)).mount(el);
		const renderSpy = vi.spyOn(v, 'render');

		v.destroy();
		store.createRecord('todo', { text: 'ghost' });
		store.flush();
		expect(renderSpy).not.toHaveBeenCalled();
	});

	it('a newer refresh supersedes a stale in-flight async data() run', async () => {
		let delay = 20;
		class V extends PuzzleView {
			async data({ params }) {
				const d = delay;
				await new Promise((r) => setTimeout(r, d));
				return { label: `${params.id} (after ${d}ms)` };
			}
			render() { return h('p', {}, [text(this.getData().label)]); }
		}
		const el = container();
		const v = await new V().mount(el, { params: { id: 'slow' } });

		const slow = v.refresh({ params: { id: 'stale' } }); // 20ms
		delay = 1;
		const fast = v.refresh({ params: { id: 'fresh' } }); // 1ms, newer token
		await Promise.all([slow, fast]);
		expect(el.textContent).toBe('fresh (after 1ms)'); // stale result discarded
	});
});

describe('PuzzleView — skeleton loading (v1.8, D39)', () => {
	// Hand-written version of what the compiler emits for a .pzl carrying a
	// <puzzle-skeleton>: renderSkeleton attached via prototype assignment,
	// exactly like render().
	const deferred = () => {
		let resolve, reject;
		const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
		return { promise, resolve, reject };
	};

	const makeSkeletonView = (gate) => {
		class V extends PuzzleView {
			async data() {
				const post = await gate.promise;
				return { post };
			}
		}
		V.prototype.render = function () {
			return h('article', {}, [text(this.getData().post)]);
		};
		V.prototype.renderSkeleton = function () {
			return h('article', { class: 'is-loading' }, [h('div', { class: 'bg-skeleton' })]);
		};
		return V;
	};

	it('renders the skeleton while the first data() is pending, then swaps in the real render', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate);
		const el = container();
		const v = await new V().mount(el); // resolves after the SKELETON render
		expect(v.loaded).toBe(false);
		expect(el.querySelector('article.is-loading .bg-skeleton')).toBeTruthy();

		gate.resolve('real content');
		await gate.promise;
		await Promise.resolve(); // let refresh()'s .then(commit) run
		expect(v.loaded).toBe(true);
		expect(el.textContent).toBe('real content');
		expect(el.querySelector('.is-loading')).toBeNull(); // skeleton gone
	});

	it('mounted() fires once the skeleton is in the DOM, before data() resolves', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate);
		let mountedSaw;
		V.prototype.mounted = function () {
			mountedSaw = this.element.className;
		};
		await new V().mount(container());
		expect(mountedSaw).toBe('is-loading'); // fired against the skeleton DOM
		gate.resolve('x');
	});

	it('a synchronous data() never shows the skeleton', async () => {
		class V extends PuzzleView {
			data() { return { msg: 'instant' }; }
		}
		V.prototype.render = function () { return h('p', {}, [text(this.getData().msg)]); };
		V.prototype.renderSkeleton = function () { return h('p', { class: 'is-loading' }, []); };
		const el = container();
		const v = await new V().mount(el);
		expect(v.loaded).toBe(true);
		expect(el.textContent).toBe('instant');
		expect(el.querySelector('.is-loading')).toBeNull();
	});

	it('setState during the skeleton phase re-renders the skeleton with created()-seeded state', async () => {
		const gate = deferred();
		class V extends PuzzleView {
			created() { this.setState({ rows: 2 }); }
			async data() { return { post: await gate.promise }; }
		}
		V.prototype.render = function () { return h('article', {}, [text(this.getData().post)]); };
		V.prototype.renderSkeleton = function () {
			const { rows } = this.getData();
			return h('article', { class: 'is-loading' },
				Array.from({ length: rows }, (_, i) => h('div', { key: i, class: 'bg-skeleton' })));
		};
		const el = container();
		const v = await new V().mount(el);
		expect(el.querySelectorAll('.bg-skeleton')).toHaveLength(2);

		v.setState('rows', 4); // still loading — skeleton re-renders
		v.flushUpdates();
		expect(el.querySelectorAll('.bg-skeleton')).toHaveLength(4);
		gate.resolve('done');
	});

	it('a later refresh keeps the real content up — the skeleton never returns', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate);
		const el = container();
		const v = await new V().mount(el);
		gate.resolve('first');
		await gate.promise;
		await Promise.resolve();
		expect(el.textContent).toBe('first');

		// subsequent refresh (store change / params) — old content stays visible
		// while the new data loads; loaded never resets.
		let release;
		v.data = () => new Promise((r) => { release = () => r({ post: 'second' }); });
		const p = v.refresh();
		expect(el.textContent).toBe('first');
		expect(el.querySelector('.is-loading')).toBeNull();
		release();
		await p;
		expect(el.textContent).toBe('second');
	});

	it('a data() rejection behind a skeleton is logged and leaves the recovery placeholder', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const el = container();
		const v = await new V().mount(el); // resolves at the skeleton render
		gate.reject(new Error('load failed'));
		await new Promise((r) => setTimeout(r, 0)); // let the rejection propagate
		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] data() failed behind a skeleton:',
			expect.any(Error)
		);
		expect(el.querySelector('.is-loading')).toBeNull();
		expect(el.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
		expect(v.isDestroyed).toBe(true);
		expect(v.loaded).toBe(false);
		errSpy.mockRestore();
	});
});

describe('PuzzleView — fire-and-forget refresh rejections are logged (not unhandled)', () => {
	// FIX: onStoreChange() and applyParentUpdate()'s prop branch discard
	// refresh()'s promise; a rejecting async data() there was an unhandled
	// rejection. Both now .catch() with a console.error, matching mount's
	// skeleton-path logging.

	it('a store-change refresh whose data() rejects is logged, not unhandled', async () => {
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		let shouldReject = false;
		class V extends PuzzleView {
			async data() {
				const todos = this.ctx.store.findMany('todo'); // subscribes to 'todo'
				if (shouldReject) throw new Error('refresh boom');
				return { todos };
			}
			render() { return h('div', {}, [text('ok')]); }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const el = container();
		await new V(ctxWith(store)).mount(el);

		// A store change → onStoreChange → refresh() → async data() rejects.
		shouldReject = true;
		store.findOne('todo', 't1').update({ text: 'y' });
		store.flush(); // sync-notifies → onStoreChange (async refresh kicked off)
		await new Promise((r) => setTimeout(r, 0)); // let the rejection propagate

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] data() failed during a store-change refresh:',
			expect.any(Error)
		);
		errSpy.mockRestore();
	});

	it('a parent prop update whose data() rejects is logged, not unhandled', async () => {
		let shouldReject = false;
		class V extends PuzzleView {
			async data({ props }) {
				if (shouldReject) throw new Error('prop boom');
				return { label: props.label ?? 'init' };
			}
			render() { return h('div', {}, [text(this.getData().label ?? '')]); }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const v = await new V().mount(container(), { props: { label: 'a' } });

		shouldReject = true;
		v.applyParentUpdate({ props: { label: 'b' } }); // prop branch → refresh({ props })
		await new Promise((r) => setTimeout(r, 0)); // let the rejection propagate

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] data() failed during a parent prop update:',
			expect.any(Error)
		);
		errSpy.mockRestore();
	});
});

describe('PuzzleView — a synchronously throwing data() is contained, not propagated', () => {
	// Companion to the async-rejection block above. withTracking rethrows SYNC
	// errors (so the router/mount callers still see a data() throw), so a data()
	// that throws synchronously escapes refresh(). onStoreChange() and
	// applyParentUpdate() now catch it — otherwise a store-change throw would
	// escape into Store.flush() and strand every later subscriber.

	it('a sync-throwing data() during a store-change refresh is logged; flush() survives and other views still update', async () => {
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		let shouldThrow = false;
		class Boom extends PuzzleView {
			data() {
				const todos = this.ctx.store.findMany('todo'); // subscribes to 'todo'
				if (shouldThrow) throw new Error('sync boom');
				return { todos };
			}
			render() { return h('div', {}, [text('boom')]); }
		}
		class Good extends PuzzleView {
			data() {
				const todos = this.ctx.store.findMany('todo'); // also subscribes to 'todo'
				return { n: todos.length };
			}
			render() { return h('div', {}, [text(String(this.getData().n))]); }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await new Boom(ctxWith(store)).mount(container()); // subscribes first → notified first
		const goodEl = container();
		await new Good(ctxWith(store)).mount(goodEl);

		// A store change fans out to both views' onStoreChange in one flush. Boom
		// throws synchronously; the flush must survive and still reach Good.
		shouldThrow = true;
		store.createRecord('todo', { id: 't2', text: 'y' });
		expect(() => store.flush()).not.toThrow();

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] data() failed during a store-change refresh:',
			expect.any(Error)
		);
		expect(goodEl.textContent).toBe('2'); // the other subscriber still re-rendered
		errSpy.mockRestore();
	});

	it('a sync-throwing data() during a parent prop update is logged, not propagated', async () => {
		let shouldThrow = false;
		class V extends PuzzleView {
			data({ props }) {
				if (shouldThrow) throw new Error('prop sync boom');
				return { label: props.label ?? 'init' };
			}
			render() { return h('div', {}, [text(this.getData().label ?? '')]); }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const v = await new V().mount(container(), { props: { label: 'a' } });

		shouldThrow = true;
		expect(() => v.applyParentUpdate({ props: { label: 'b' } })).not.toThrow();

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] data() failed during a parent prop update:',
			expect.any(Error)
		);
		errSpy.mockRestore();
	});
});

describe('route snapshot (v1.15, D47)', () => {
	// The router threads a frozen `to` ({ path, route, params, chain }) into
	// preload()/refresh() as `route`; PuzzleView stores it and exposes it as
	// `this.route`. An argless refresh() (the store-change path) must RETAIN the
	// stored snapshot; refresh({ route }) overwrites it; refresh({ params }) with
	// no route key retains it. Off-router (never threaded) it stays null.

	it('route is null by default (a component the router never mounted)', () => {
		const v = new PuzzleView({});
		expect(v.route).toBeNull();
	});

	it('preload({ route }) stores the snapshot; argless refresh() retains it', async () => {
		const r1 = { path: '/a', route: { name: 'a' }, params: {}, chain: [] };
		const v = new PuzzleView({});
		await v.preload({ params: {}, props: {}, route: r1 });
		expect(v.route).toBe(r1);

		v.refresh(); // store-change path — no route arg
		expect(v.route).toBe(r1); // retained across a store-change refresh
	});

	it('refresh({ route }) overwrites; refresh({ params }) with no route key retains', async () => {
		const r1 = { path: '/a', route: { name: 'a' }, params: {}, chain: [] };
		const r2 = { path: '/b', route: { name: 'b' }, params: {}, chain: [] };
		const v = new PuzzleView({});
		await v.preload({ params: {}, props: {}, route: r1 });
		expect(v.route).toBe(r1);

		v.refresh({ route: r2 }); // explicit new snapshot
		expect(v.route).toBe(r2);

		v.refresh({ params: { id: '1' } }); // params-only — no route key
		expect(v.route).toBe(r2); // retained
	});
});

describe('PuzzleView — events integration (mini hand-compiled component)', () => {
	// Hand-written version of what the compiler will emit for a tiny .pzl —
	// the same pattern the Phase 1 Home.pzl fixture uses.
	class MiniCounter extends PuzzleView {
		created() {
			this.setState({ count: 0 });
		}

		data() {
			return { count: this.getData().count ?? 0 };
		}

		events = {
			increment: (event) => {
				this.setState('count', this.getData().count + 1);
			},
		};
	}
	// compiler output: render attached via prototype assignment (SPEC §4)
	MiniCounter.prototype.render = function () {
		const d = this.getData();
		return h('div', {}, [
			h('span', { id: 'n' }, [text(String(d.count))]),
			h('button', { '@click': (event) => this.events.increment(event) }, [text('+1')]),
		]);
	};

	it('clicking wires @attr → events field arrow → setState → DOM update', async () => {
		const el = container();
		const v = await new MiniCounter().mount(el);
		expect(el.querySelector('#n').textContent).toBe('0');

		el.querySelector('button').click();
		v.flushUpdates();
		expect(el.querySelector('#n').textContent).toBe('1');

		el.querySelector('button').click();
		el.querySelector('button').click();
		v.flushUpdates();
		expect(el.querySelector('#n').textContent).toBe('3');
	});

	it('events arrows keep `this` bound even when detached (class-field semantics)', async () => {
		const v = await new MiniCounter().mount(container());
		const { increment } = v.events; // detach — delegation-style call
		increment({});
		v.flushUpdates();
		expect(v.getData().count).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Controlled `checked` reflects to the CONTENT attribute even when the property
// already agrees. The live-DOM guard in patchAttrs short-circuits exactly when
// the USER moved checkedness, which is the only path that leaves the attribute
// stale — `el.checked = x` writes the property, never the attribute. Skipping
// the write there breaks viewManager's own "keep boolean ATTRIBUTES coherent
// for CSS selectors" rule for `checked` alone.
// ---------------------------------------------------------------------------
describe('controlled `checked` keeps its content attribute coherent', () => {
	class Box extends PuzzleView {
		data() {
			return { on: this.getData().on ?? true };
		}
	}
	Box.prototype.render = function () {
		return h('div', {}, [h('input', { type: 'checkbox', checked: this.getData().on }, [])]);
	};

	it('drops the attribute after a user click flips state to false', async () => {
		const el = container();
		const v = await new Box().mount(el);
		const box = el.querySelector('input');
		expect(box.checked).toBe(true);
		expect(box.hasAttribute('checked')).toBe(true);

		// The browser moves the property on click; the app mirrors it into state.
		box.checked = false;
		v.setState('on', false);
		v.flushUpdates();

		expect(box.checked).toBe(false);
		expect(box.hasAttribute('checked')).toBe(false);
		// The stale attribute used to survive here, so `input[checked]` matched an
		// unchecked box and form.reset() re-checked it with no change event.
		expect(el.querySelectorAll('input[checked]').length).toBe(0);
	});

	it('adds the attribute after a user click flips state to true', async () => {
		const el = container();
		const v = await new Box().mount(el);
		v.setState('on', false);
		v.flushUpdates();
		const box = el.querySelector('input');
		expect(box.hasAttribute('checked')).toBe(false);

		box.checked = true;
		v.setState('on', true);
		v.flushUpdates();

		expect(box.checked).toBe(true);
		expect(box.hasAttribute('checked')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// D145 states "never patched over an unknown tree" as an invariant of the
// MANAGER. A view with no app error view uses the invisible recovery placeholder;
// a later owner-driven render must still not diff
// against a currentTree whose vnodes point at detached nodes.
// ---------------------------------------------------------------------------
describe('ViewManager — an unknown tree is never patched over', () => {
	it('routes the next ordinary render through a fresh mount, with no orphaned DOM', async () => {
		const el = container();
		let poisoned = false;
		let n = 1;

		class Fragile extends PuzzleView {
			data() {
				return { n, poisoned };
			}
		}
		Fragile.prototype.render = function () {
			const d = this.getData();
			// Row 1 CHANGES TAG when poisoned, so the patch replaces real DOM before
			// row 3's throwing ref aborts it — that half-updated state is the whole
			// point. A throw on the first child would leave the DOM still matching the
			// old tree and prove nothing.
			return h('section', { class: 'shell' }, [
				d.poisoned
					? h('span', { class: 'row row-1' }, [text(`S${d.n}`)])
					: h('div', { class: 'row row-1' }, [text(`D${d.n}`)]),
				h('div', { class: 'row row-2' }, [text(`two${d.n}`)]),
				d.poisoned
					? h('div', { class: 'row row-3', ref: () => { throw new Error('ref boom'); } }, [text('x')])
					: h('div', { class: 'row row-3' }, [text(`three${d.n}`)]),
			]);
		};

		const v = await new Fragile().mount(el);
		expect(el.querySelector('.row-1').textContent).toBe('D1');

		// Abort a patch partway. With no app error view, the replacement path leaves
		// only the stable recovery position.
		poisoned = true;
		n = 2;
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		// refresh(), not setState: data() reads module variables the runtime
		// cannot see, so only an on-purpose re-run builds the poisoned tree.
		let aborted = false;
		try {
			await v.refresh();
			v.flushUpdates();
		} catch {
			aborted = true;
		}
		expect(aborted).toBe(true); // the patch really did abort partway

		// The next ordinary render must show CURRENT state, not a frozen orphan.
		poisoned = false;
		n = 3;
		await v.refresh();
		v.flushUpdates();
		logged.mockRestore();

		expect(el.querySelector('.row-1')?.textContent).toBe('D3');
		expect(el.querySelector('.row-2')?.textContent).toBe('two3');
		expect(el.querySelector('.row-3')?.textContent).toBe('three3');
		// Exactly one of each — a fresh mount over a cleared range, not a duplicate,
		// and no leftover <span> orphaned by the aborted patch.
		expect(el.querySelectorAll('.row-1').length).toBe(1);
		expect(el.querySelectorAll('span.row-1').length).toBe(0);
		expect(el.querySelectorAll('.row').length).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// A view the router restored after a stalled out-animation is live again, so the
// leave that eventually succeeds must make it inert a second time. playOut()'s
// out sequence is spent (no second animation, per the router's recovery
// contract) but D136's leave-inertness rule is about the LEAVE, not the
// animation — the restored view must still unsubscribe on its way out.
// ---------------------------------------------------------------------------
describe('PuzzleView — a restored view goes inert again when it really leaves', () => {
	class Leaver extends PuzzleView {
		data() {
			return { n: 1 };
		}
	}
	Leaver.prototype.render = function () {
		return h('div', {}, [text('leaver')]);
	};

	it('re-arms the leaving guard and drops the subscription on the second playOut', async () => {
		installFakeAnimate();
		{
			const store = new Store({ todo: Todo });
			const v = new Leaver(ctxWith(store));
			await v.mount(container());

			const unsubscribe = vi.spyOn(store, 'unsubscribe');

			v.playOut();
			expect(unsubscribe).toHaveBeenCalledTimes(1);
			expect(v.setState('x', 1)).toBe(undefined);
			// Inert while leaving: setState is a no-op.
			expect(v.getData().x).toBe(undefined);

			// The router's failed-navigation recovery puts it back.
			v._restoreFromLeaving();
			await afterFrame();
			v.setState('x', 2);
			expect(v.getData().x).toBe(2); // reactive again

			// Now it leaves for real.
			unsubscribe.mockClear();
			v.playOut();
			expect(unsubscribe).toHaveBeenCalledTimes(1); // inert again
			v.setState('x', 3);
			expect(v.getData().x).toBe(2); // still 2 — the write was refused
		}
	});
});
