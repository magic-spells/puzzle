// @vitest-environment jsdom
//
// A failed child component sitting UNDER an element vnode that the next patch
// receives as the very same object (D170's identity short-circuit).
//
// Two things hand a patch the same element object on both sides: a list block's
// cached row, and slot content a wrapper splices back in by reference. patch()
// returns at such an element without looking underneath, so a child whose mount
// failed below it was never revisited — an errorView retry blanked its position
// (DOC-SPEC-VIEW: "a retry never blanks its position"), and without an errorView
// the next parent patch never mounted a fresh instance (D115). 0.7.0 built every
// vnode fresh, so both recovered there.
//
// The failure handler and the retry both mark the view whose patch owns the
// position; that one render walks element vnodes instead of short-circuiting,
// reaching the destroyed child and remounting it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, mountView, settled } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { listRows } from '../client-runtime/views/listBlock.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);

// The shape `key={item}` compiles to: for a primitive row the key IS the item.
const KEY = { key: (item) => item };

const handles = [];
const apps = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	for (const app of apps.splice(0)) app.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

async function flush() {
	for (let i = 0; i < 4; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
		await settled();
	}
}

// `<div class="card"><Children/></div>` — places the caller's vnodes by reference.
class Card extends PuzzleView {
	render() {
		return h('div', { class: 'card' }, [new ViewNode(SLOT_TAG, {}, [])]);
	}
}

// A child whose data() rejects until `state.fail` is cleared.
function failingWidget(state) {
	return class Widget extends PuzzleView {
		async data() {
			state.attempts++;
			if (state.fail) throw new Error('not yet');
			return {};
		}
		render() {
			return h('b', { class: 'ready' }, [text('ready')]);
		}
	};
}

describe('errorView retry reaches a failed child under a reused element vnode', () => {
	async function retryThrough(hostRender) {
		const state = { fail: true, attempts: 0 };
		const Widget = failingWidget(state);
		let retry;
		class ErrorView extends PuzzleView {
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'app-error' }, [text(this.props.error.message)]);
			}
		}
		class Host extends PuzzleView {
			data() {
				return { ids: ['a'] };
			}
			render() {
				return hostRender(this, Widget);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();
		expect(app.find('.app-error')).not.toBeNull();
		expect(state.attempts).toBe(1);

		state.fail = false;
		await retry();
		await flush();
		return { app, state };
	}

	it('<Card><div><Widget/></div></Card>: the wrapper re-renders the same slot element', async () => {
		const { app, state } = await retryThrough((view, Widget) =>
			h('puzzle-view', {}, [comp(Card, {}, [h('div', { class: 'wrap' }, [comp(Widget)])])])
		);
		expect(app.find('.wrap .ready')?.textContent).toBe('ready');
		expect(app.find('.app-error')).toBeNull();
		expect(state.attempts).toBe(2);
	});

	it('<Card>{#for}<li><Widget/></li>{/for}</Card>: a cached row that is slot content', async () => {
		const { app, state } = await retryThrough((view, Widget) =>
			h('puzzle-view', {}, [
				comp(
					Card,
					{},
					listRows(view, view, 0, view.getData().ids, (s) => h('li', { key: s.k }, [comp(Widget)]), KEY)
				),
			])
		);
		expect(app.find('li .ready')?.textContent).toBe('ready');
		expect(app.find('.app-error')).toBeNull();
		expect(state.attempts).toBe(2);
	});
});

describe('without an errorView, the next parent patch remounts a failed child (D115)', () => {
	async function mountHost(row) {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const state = { fail: true, attempts: 0 };
		const Widget = failingWidget(state);
		// `{#for id in ids}<li key={id}><Widget/></li>{/for}` (or the row root
		// itself a component). `n` is read outside the loop, so bumping it is an
		// unrelated parent render: the row's inputs never change and it stays cached.
		class Host extends PuzzleView {
			created() {
				this.n = 0;
			}
			data() {
				return { ids: ['a'], n: this.n };
			}
			render() {
				const d = this.getData();
				return h('div', {}, [
					h('span', { class: 'n' }, [text(d.n)]),
					h('ul', {}, listRows(this, this, 0, d.ids, (s) => row(s, Widget), KEY)),
				]);
			}
		}
		const view = await mountView(Host);
		handles.push(view);
		await flush();
		expect(view.find('.ready')).toBeNull();
		expect(state.attempts).toBe(1);

		state.fail = false;
		view.instance.n = 1;
		await view.instance.refresh();
		await flush();
		expect(view.find('.n').textContent).toBe('1');
		return { view, state };
	}

	it('<li><Widget/></li>: a component nested under a cached row', async () => {
		const { view, state } = await mountHost((s, Widget) => h('li', { key: s.k }, [comp(Widget)]));
		expect(view.find('li .ready')?.textContent).toBe('ready');
		expect(state.attempts).toBe(2);
	});

	it('control: <Widget/> as the row root', async () => {
		const { view, state } = await mountHost((s, Widget) => comp(Widget, { key: s.k }));
		expect(view.find('ul .ready')?.textContent).toBe('ready');
		expect(state.attempts).toBe(2);
	});
});
