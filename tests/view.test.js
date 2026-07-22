// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

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
			data(params, props) { seen = { params, props }; return {}; }
		}
		await new V().mount(container(), { params: { id: '42' }, props: { userId: 7 } });
		expect(seen).toEqual({ params: { id: '42' }, props: { userId: 7 } });
	});

	it('setData in created() seeds state that data() reads back — the TodoHome pattern', async () => {
		class V extends PuzzleView {
			created() { this.setData({ currentFilter: 'all' }); }
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
			async data(params, props) {
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

describe('PuzzleView — setData semantics (SPEC §4)', () => {
	class Counter extends PuzzleView {
		data() { return { count: this.getData().count ?? 0 }; }
		render() { return h('span', {}, [text(`count: ${this.getData().count}`)]); }
	}

	it('re-renders WITHOUT re-running data()', async () => {
		const v = new Counter();
		const dataSpy = vi.spyOn(v, 'data');
		const el = container();
		await v.mount(el);
		expect(dataSpy).toHaveBeenCalledTimes(1);

		v.setData('count', 5);
		v.flushUpdates();
		expect(el.textContent).toBe('count: 5');
		expect(dataSpy).toHaveBeenCalledTimes(1); // still once
	});

	it('batches multiple setData calls into one render with beforeUpdate/afterUpdate around it', async () => {
		const hooks = [];
		class V extends Counter {
			beforeUpdate() { hooks.push('before'); }
			afterUpdate() { hooks.push('after'); }
		}
		const v = new V();
		const el = container();
		await v.mount(el);
		expect(hooks).toEqual([]); // hooks do not fire on initial render

		v.setData('count', 1);
		v.setData('count', 2);
		v.setData('count', 3);
		v.flushUpdates();
		expect(el.textContent).toBe('count: 3');
		expect(hooks).toEqual(['before', 'after']); // one update cycle
	});

	it('a throwing update never wedges the scheduler', async () => {
		let boom = true;
		class V extends Counter {
			beforeUpdate() { if (boom) { boom = false; throw new Error('boom'); } }
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const v = new V();
		const el = container();
		await v.mount(el);

		v.setData('count', 1);
		v.flushUpdates(); // throws internally, reported, not rethrown
		v.setData('count', 2);
		v.flushUpdates();
		expect(el.textContent).toBe('count: 2'); // scheduler recovered
		errSpy.mockRestore();
	});
});

describe('PuzzleView — two-layer data()/setData semantics (Change C, SPEC §4)', () => {
	// #local (setData) and #model (last successful data(), replaced wholesale) compose
	// into the visible getData(): the model overlays local (a data() commit beats an
	// EARLIER setData); a LATER setData beats the model value until the next commit.
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
		v.setData('b', 99);
		phase = 2; v.refresh();
		expect(v.getData().b).toBe(99);
	});

	it('2. local setData state survives data() re-runs when the model omits the key', async () => {
		const v = makeView(() => ({ n: 1 }));
		await v.mount(container());
		v.setData('draft', 'hello');
		expect(v.getData()).toEqual({ n: 1, draft: 'hello' });
		v.refresh(); // model still { n: 1 } — no draft
		expect(v.getData().draft).toBe('hello');
	});

	it('3. a data() commit overwrites an earlier setData value for the same key', async () => {
		let val = 'model-A';
		const v = makeView(() => ({ x: val }));
		await v.mount(container());
		v.setData('x', 'local-override');
		expect(v.getData().x).toBe('local-override'); // later setData wins for now
		val = 'model-B';
		v.refresh();
		expect(v.getData().x).toBe('model-B'); // the commit beats the earlier setData
	});

	it('4. a later setData overwrites the model value until the next commit', async () => {
		const v = makeView(() => ({ x: 'from-model' }));
		await v.mount(container());
		expect(v.getData().x).toBe('from-model');
		v.setData('x', 'from-local');
		expect(v.getData().x).toBe('from-local'); // wins until the next commit
		v.refresh();
		expect(v.getData().x).toBe('from-model'); // the next commit re-asserts the model
	});

	it('5. created()-seeded setData is readable in the first data() (getData inside data)', async () => {
		let seen;
		class V extends PuzzleView {
			created() { this.setData({ seed: 'seeded' }); }
			data() { seen = this.getData().seed; return { echoed: this.getData().seed }; }
			render() { return h('span', {}, [text(this.getData().echoed ?? '')]); }
		}
		const v = new V();
		await v.mount(container());
		expect(seen).toBe('seeded');
		expect(v.getData()).toEqual({ seed: 'seeded', echoed: 'seeded' });
	});

	it('6. a superseded stale-token data() run touches neither layer', async () => {
		const slow = mkGate();
		class V extends PuzzleView {
			async data(params, props) {
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
			async data(params) {
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

	it('setData during the skeleton phase re-renders the skeleton with created()-seeded state', async () => {
		const gate = deferred();
		class V extends PuzzleView {
			created() { this.setData({ rows: 2 }); }
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

		v.setData('rows', 4); // still loading — skeleton re-renders
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

	it('a data() rejection behind a skeleton is logged; the mount promise still resolves', async () => {
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
		expect(el.querySelector('.is-loading')).toBeTruthy(); // skeleton stays up
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
			async data(params, props) {
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
			data(params, props) {
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
			this.setData({ count: 0 });
		}

		data() {
			return { count: this.getData().count ?? 0 };
		}

		events = {
			increment: (event) => {
				this.setData('count', this.getData().count + 1);
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

	it('clicking wires @attr → events field arrow → setData → DOM update', async () => {
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
