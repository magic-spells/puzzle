// @vitest-environment jsdom
//
// The keyed move guard reads `newChild.el` with no null check
// (patchKeyedChildren: `nextPersistentSibling(newChild.el)`, then
// `ref = newChild.el`). These tests reorder keyed lists while each row is in a
// state that could plausibly leave its vnode without a node: a component row
// still waiting on async data(), one whose mount failed (bare placeholder, or the
// app errorView in its place), one destroyed out of band, one torn down while
// pending and re-added, one showing a skeleton, a row whose root is a failed
// component, and keyed rows beside a live-HTML range, an `{#if}` placeholder, a
// <Portal> and slot content. Every reorder must patch cleanly with the rows in
// order.
//
// The render functions are the compiler's output for the template in each
// comment (pzlc -mode component), with `__l` = listRows.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setErrorConfig } from '../client-runtime/errors.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { PORTAL_TAG, SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { listRows as __l } from '../client-runtime/views/listBlock.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const byId = { key: (item) => item?.id };

const hosts = [];

afterEach(() => {
	for (const host of hosts.splice(0)) host.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

// Timers + microtasks: re-renders go through requestAnimationFrame (a ~16ms
// timer in jsdom), and a child mount resolves across microtasks. settled() is
// not usable here — it would wait on the rows' gated data().
async function flush() {
	for (let i = 0; i < 4; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
		await Promise.resolve();
	}
}

/**
 * Mount a host whose render is `render(this, data)`, seeded with `initial`, with
 * every framework-contained error collected through the app error funnel (and,
 * when given, the app `errorView`).
 */
async function setup(render, initial, errorView = null) {
	class Host extends PuzzleView {
		created() {
			this.setData(initial);
		}
		render() {
			return render(this, this.getData());
		}
	}
	const errors = [];
	const ctx = {};
	setErrorConfig(ctx, (error, info) => errors.push({ message: error.message, phase: info.phase }), errorView);
	const container = document.createElement('div');
	document.body.appendChild(container);
	const host = new Host(ctx);
	hosts.push(host);
	await host.mount(container);
	await flush();
	return { host, errors, ul: () => container.querySelector('ul') };
}

const ORDERS = [
	['c', 'a', 'b'],
	['b', 'c', 'a'],
	['a', 'b', 'c'],
];

const items = (...ids) => ({ items: ids.map((id) => ({ id })) });
const liText = (ul) => [...ul.querySelectorAll('li')].map((li) => li.textContent);

/** Reorder through every ORDERS permutation, checking the rows each time. */
async function reorder(host, ul, expected = (ids) => ids) {
	for (const ids of ORDERS) {
		host.setData(items(...ids));
		await flush();
		expect(liText(ul())).toEqual(expected(ids));
	}
}

/** Reorder through every ORDERS permutation without checking (rows pending). */
async function shuffle(host) {
	for (const ids of ORDERS) {
		host.setData(items(...ids));
		await flush();
	}
}

// <ul>{#for item in items}<Row key={ item.id } item={ item }/>{/for}</ul>
const rowList = (Row) => (view, d) =>
	h('ul', {}, [...__l(view, view, 0, d.items, (s) => new ViewNode(Row, { key: s.k, item: s.item }, []), byId)]);

/** A Row whose data() waits on a gate the test opens. */
function gatedRow({ skeleton = false } = {}) {
	const gates = [];
	class Row extends PuzzleView {
		async data(params, props) {
			await new Promise((resolve) => gates.push(resolve));
			return { id: props.item.id };
		}
		render() {
			return h('li', {}, [text(this.getData().id)]);
		}
	}
	if (skeleton) Row.prototype.renderSkeleton = () => h('li', { class: 'sk' }, [text('…')]);
	return { Row, open: () => gates.splice(0).forEach((resolve) => resolve()) };
}

describe('keyed move guard: every paired row carries a node', () => {
	it('component rows still waiting on async data()', async () => {
		const { Row, open } = gatedRow();
		const { host, ul, errors } = await setup(rowList(Row), items('a', 'b', 'c'));
		// Every row is still its anchor comment while the list reorders.
		await shuffle(host);
		open();
		await flush();
		await reorder(host, ul);
		expect(errors).toEqual([]);
	});

	it('component rows behind a skeleton', async () => {
		const { Row, open } = gatedRow({ skeleton: true });
		const { host, ul, errors } = await setup(rowList(Row), items('a', 'b', 'c'));
		expect(liText(ul())).toEqual(['…', '…', '…']);
		await shuffle(host);
		open();
		await flush();
		await reorder(host, ul);
		expect(errors).toEqual([]);
	});

	it('a pending component row removed and re-added before its data() resolves', async () => {
		const { Row, open } = gatedRow();
		const { host, ul, errors } = await setup(rowList(Row), items('a', 'b', 'c'));
		host.setData(items('a', 'c'));
		await flush();
		host.setData(items('a', 'b', 'c'));
		await flush();
		open();
		await flush();
		await reorder(host, ul);
		expect(errors).toEqual([]);
	});

	it('component rows whose mount failed (placeholder left, no errorView)', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		class Row extends PuzzleView {
			data(params, props) {
				if (props.item.id === 'b') throw new Error('row boom');
				return { id: props.item.id };
			}
			render() {
				return h('li', {}, [text(this.getData().id)]);
			}
		}
		const { host, ul, errors } = await setup(rowList(Row), items('a', 'b', 'c'));
		// `b` fails on every mount, so it never shows; the rest keep their order.
		await reorder(host, ul, (ids) => ids.filter((id) => id !== 'b'));
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.every((e) => e.message === 'row boom')).toBe(true);
	});

	it('component rows replaced by the app errorView', async () => {
		class AppError extends PuzzleView {
			render() {
				return h('li', { class: 'err' }, [text('!' + this.props.error.message)]);
			}
		}
		class Row extends PuzzleView {
			data(params, props) {
				if (props.item.id === 'b') throw new Error('b');
				return { id: props.item.id };
			}
			render() {
				return h('li', {}, [text(this.getData().id)]);
			}
		}
		const { host, ul, errors } = await setup(rowList(Row), items('a', 'b', 'c'), AppError);
		expect(liText(ul())).toEqual(['a', '!b', 'c']);
		await reorder(host, ul, (ids) => ids.map((id) => (id === 'b' ? '!b' : id)));
		expect(errors).toEqual([{ message: 'b', phase: 'mount' }]);
	});

	it('a component row destroyed out of band', async () => {
		const rows = {};
		class Row extends PuzzleView {
			data(params, props) {
				rows[props.item.id] = this;
				return { id: props.item.id };
			}
			render() {
				return h('li', {}, [text(this.getData().id)]);
			}
		}
		const { host, ul, errors } = await setup(rowList(Row), items('a', 'b', 'c'));
		const dead = rows.b;
		dead.destroy();
		// The parent's next patch finds the destroyed instance and mounts a fresh one.
		await reorder(host, ul);
		expect(rows.b).not.toBe(dead);
		expect(errors).toEqual([]);
	});

	it('a component row whose own root is a component that failed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		// Row.pzl is `<Inner item={ item }/>` as its root; Inner fails for `b`.
		class Inner extends PuzzleView {
			data(params, props) {
				if (props.item.id === 'b') throw new Error('inner boom');
				return { id: props.item.id };
			}
			render() {
				return h('li', {}, [text(this.getData().id)]);
			}
		}
		class Row extends PuzzleView {
			render() {
				return new ViewNode(Inner, { item: this.props.item }, []);
			}
		}
		const { host, ul } = await setup(rowList(Row), items('a', 'b', 'c'));
		await reorder(host, ul, (ids) => ids.filter((id) => id !== 'b'));
	});

	it('keyed rows beside a live-HTML range, an {#if} placeholder, a Portal and slot content', async () => {
		// <ul>
		//   {#for item in items}<li key={ item.id }>{ item.id }</li>{/for}
		//   { raw(html) }
		//   {#if flag}<b>x</b>{/if}
		//   <Portal><p>tail</p></Portal>
		//   <Children/>
		// </ul>
		const { host, ul, errors } = await setup(
			(view, d) =>
				h('ul', {}, [
					...__l(view, view, 0, d.items, (s) => h('li', { key: s.k }, [text(s.item.id)]), byId),
					h('#html', { value: d.html }),
					...(d.flag ? [h('b', {}, [text('x')])] : [h('#')]),
					h(PORTAL_TAG, {}, [h('p', {}, [text('tail')])]),
					h(SLOT_TAG),
				]),
			{ ...items('a', 'b', 'c'), html: '<i>h</i>', flag: false }
		);
		for (const [i, ids] of ORDERS.entries()) {
			host.setData({ ...items(...ids), html: `<i>h${i}</i>`, flag: i % 2 === 0 });
			await flush();
			expect(liText(ul())).toEqual(ids);
			expect(ul().querySelector('i').textContent).toBe(`h${i}`);
		}
		expect(errors).toEqual([]);
	});
});
