// @vitest-environment jsdom
//
// What forces a list block to rebuild rows it would otherwise hand back from
// the cache (D170).
//
// The root dirty mask (`view.__dirty`) is a PER-RENDER delta: it says which of
// this template's loop-read roots changed in THIS render. A block that was not
// invoked in a render — its `{#if}` was false, or its enclosing row was cached
// — never sees the bits that flipped while it was away, and by the time it runs
// again the mask is clean. So the block also tracks the view's render counter
// and treats "I missed a render" as "every row is dirty this pass".
//
// The same condition is what lets an errorView retry reach a failed child that
// is sitting under a cached row: the owner's refresh would otherwise
// short-circuit at the row root and never revisit the destroyed child below it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, mountView, settled } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
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

describe('a block that skipped a render does not trust the root mask', () => {
	// `{#if show}{#for item in items}<p key={item}>{label}</p>{/for}{/if}`, with
	// `label` as the site's one read root (bit 0).
	class Toggled extends PuzzleView {
		static __roots = ['label'];

		created() {
			this.show = true;
			this.label = 'A';
			this.builds = 0;
		}

		data() {
			return { show: this.show, label: this.label, items: ['x'] };
		}

		set(patch) {
			Object.assign(this, patch);
			return this.refresh();
		}

		render() {
			const d = this.getData();
			return h(
				'div',
				{},
				d.show
					? listRows(
							this,
							this,
							0,
							d.items,
							(s) => {
								this.builds++;
								return h('p', { key: s.k }, [text(d.label)]);
							},
							{ ...KEY, roots: 1 }
						)
					: []
			);
		}
	}

	it('rebuilds rows built before the renders it sat out', async () => {
		const view = await mountView(Toggled);
		handles.push(view);
		expect(view.find('p').textContent).toBe('A');

		// Three commits, separately: hide (the block is not invoked), change the
		// root the body reads (still not invoked — this is the render whose mask
		// bit the block never sees), show again.
		await view.instance.set({ show: false });
		await view.instance.set({ label: 'B' });
		await view.instance.set({ show: true });

		expect(view.find('p').textContent).toBe('B');
	});

	it('still caches a row for a list invoked on every render', async () => {
		const view = await mountView(Toggled);
		handles.push(view);
		expect(view.instance.builds).toBe(1);

		// Two renders that change nothing the body reads: the row is handed back
		// from the cache both times.
		await view.instance.set({});
		await view.instance.set({});
		expect(view.instance.builds).toBe(1);

		// And a root the body DOES read still rebuilds it, once.
		await view.instance.set({ label: 'B' });
		expect(view.instance.builds).toBe(2);
		expect(view.find('p').textContent).toBe('B');
	});

	it('rebuilds a NESTED block whose outer row was cached across the change', async () => {
		// Outer site reads `bump` (bit 0); the inner site reads `tag` (bit 1). A
		// render that only changes `tag` leaves the outer row cached, so the inner
		// block is never invoked and never sees its own bit.
		class Nested extends PuzzleView {
			static __roots = ['bump', 'tag'];

			created() {
				this.bump = 0;
				this.tag = 'A';
			}

			data() {
				return { groups: ['g'], items: ['i'], bump: this.bump, tag: this.tag };
			}

			set(patch) {
				Object.assign(this, patch);
				return this.refresh();
			}

			render() {
				const d = this.getData();
				return h(
					'div',
					{},
					listRows(
						this,
						this,
						0,
						d.groups,
						(s) =>
							h('section', { key: s.k, 'data-bump': String(d.bump) }, [
								...listRows(
									this,
									s,
									1,
									d.items,
									(t) => h('p', { key: t.k }, [text(d.tag)]),
									{ ...KEY, roots: 2 }
								),
							]),
						{ ...KEY, roots: 1 }
					)
				);
			}
		}

		const view = await mountView(Nested);
		handles.push(view);
		expect(view.find('p').textContent).toBe('A');

		// Only `tag` changes: the outer row caches, so the inner block sits this
		// render out and the row on screen is still the old one. (A real compile
		// gives the outer site every root its body reads, nested sites included;
		// splitting them here is what makes the inner block miss a render at all.)
		await view.instance.set({ tag: 'B' });
		expect(view.find('section').dataset.bump).toBe('0');
		expect(view.find('p').textContent).toBe('A');

		// Now the outer row rebuilds for its own reason. The inner block runs again
		// with a mask that no longer mentions `tag`.
		await view.instance.set({ bump: 1 });
		expect(view.find('section').dataset.bump).toBe('1');
		expect(view.find('p').textContent).toBe('B');
	});
});

describe('errorView retry through a cached list row', () => {
	it('remounts a failed child sitting under a row whose inputs never changed', async () => {
		let attempts = 0;
		let shouldFail = true;
		let retry;
		const lifecycle = [];

		class ErrorView extends PuzzleView {
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'app-error' }, [text(this.props.error.message)]);
			}
		}
		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				attempts++;
				lifecycle.push('constructor');
			}
			data() {
				lifecycle.push('data');
				if (shouldFail) throw new Error('not yet');
				return {};
			}
			mounted() {
				lifecycle.push('mounted');
			}
			render() {
				return h('strong', { class: 'ready' }, [text('ready')]);
			}
		}
		// `{#for id in ids}<li key={id}><Child/></li>{/for}` — the row's item is a
		// primitive that never changes, so every ordinary refresh caches it.
		class Host extends PuzzleView {
			data() {
				return { ids: ['a'] };
			}
			render() {
				return h(
					'puzzle-view',
					{},
					listRows(this, this, 0, this.getData().ids, (s) => h('li', { key: s.k }, [comp(Child)]), KEY)
				);
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

		shouldFail = false;
		await retry();
		await flush();

		expect(app.find('.ready').textContent).toBe('ready');
		expect(app.find('.app-error')).toBeNull();
		expect(attempts).toBe(2);
		expect(lifecycle.slice(-3)).toEqual(['constructor', 'data', 'mounted']);
	});
});
