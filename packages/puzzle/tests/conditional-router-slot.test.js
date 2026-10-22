// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView, ViewNode, SLOT_TAG } from '../client-runtime/index.js';
import { createTestApp, settled, installFakeAnimate } from '../client-runtime/testing/index.js';
import { liveViewList } from '../client-runtime/devstate.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => h('text', { value });
const handles = [];
afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
});

describe('conditional router outlets', () => {
	it('lets an outgoing parent finish its leave before releasing pinned descendants', async () => {
		let leaf;
		class Leaf extends PuzzleView {
			created() { leaf = this; }
			render() { return h('puzzle-view', { class: 'leaf' }); }
		}
		class Parent extends PuzzleView {
			animations = { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 1000 } };
			render() { return h('puzzle-view', { class: 'parent' }, [h(SLOT_TAG)]); }
		}
		class Layout extends PuzzleView {
			render() { return h('puzzle-view', {}, [h(SLOT_TAG)]); }
		}
		const fake = installFakeAnimate();
		try {
			const app = await createTestApp({ transitionMode: 'overlap', routes: [
				{ path: '/', view: Parent, layout: Layout, children: [{ path: '', view: Leaf }] },
				{ path: '/other', view: Leaf, layout: Layout },
			] });
			handles.push(app);
			const outgoing = leaf;
			await app.visit('/other');
			expect(outgoing.isDestroyed).toBe(false);
			expect(app.find('.parent .leaf')).toBe(outgoing.element);
			fake.finishAll();
			await settled();
			expect(outgoing.isDestroyed).toBe(true);
			expect(app.find('.parent')).toBeNull();
		} finally { fake.finishAll(); fake.uninstall(); }
	});

	it('a layout re-render with its outlet in place does not re-render the routed chain', async () => {
		let layout;
		let renders = 0;
		class Leaf extends PuzzleView {
			render() { renders++; return h('puzzle-view', { class: 'leaf' }); }
		}
		class Parent extends PuzzleView {
			render() { renders++; return h('puzzle-view', {}, [h(SLOT_TAG)]); }
		}
		class Layout extends PuzzleView {
			created() { layout = this; this.setData({ n: 0 }); }
			render() { return h('puzzle-view', {}, [h('b', {}, [text(String(this.getData().n))]), h(SLOT_TAG)]); }
		}
		const app = await createTestApp({ routes: [{ path: '/', layout: Layout, view: Parent, children: [{ path: '', view: Leaf }] }] });
		handles.push(app);
		const before = renders;
		for (let n = 1; n < 4; n++) {
			layout.setData({ n });
			await settled();
		}
		expect(app.find('b').textContent).toBe('3');
		expect(renders).toBe(before);
	});

	it('destroys every level of a routed chain that never reaches an outlet', async () => {
		const instances = [];
		class Page extends PuzzleView {
			created() { instances.push(this); }
			render() { return h('puzzle-view', {}, [h(SLOT_TAG)]); }
		}
		class Layout extends PuzzleView {
			render() { return h('puzzle-view'); }
		}
		const app = await createTestApp({ routes: [{ path: '/', layout: Layout, view: Page, children: [{ path: '', view: Page }] }] });
		handles.push(app);
		expect(instances).toHaveLength(2);
		expect(instances.every((view) => view.element === null)).toBe(true);
		app.destroy();
		expect(instances.every((view) => view.isDestroyed)).toBe(true);
	});

	it('updates a reused hidden route chain and releases every superseded leaf', async () => {
		let layout;
		let parent;
		const leaves = [];
		class Leaf extends PuzzleView {
			created() { leaves.push(this); }
			render() { return h('puzzle-view', { class: 'leaf' }, [text(this.route.pathname)]); }
		}
		class Parent extends PuzzleView {
			created() { parent = this; }
			render() { return h('puzzle-view', { class: 'parent' }, [h(SLOT_TAG)]); }
		}
		class Layout extends PuzzleView {
			created() { layout = this; this.setData({ open: true }); }
			render() { return h('puzzle-view', {}, [this.getData().open ? h(SLOT_TAG) : h('p', {}, [text('closed')])]); }
		}
		const app = await createTestApp({ routes: [{ path: '/', layout: Layout, view: Parent, children: [
			{ path: '', view: Leaf }, { path: 'two', view: Leaf }, { path: 'three', view: Leaf },
		] }] });
		handles.push(app);
		const root = parent.element;
		layout.setData({ open: false });
		await settled();
		await app.visit('/two');
		expect(leaves[0].isDestroyed).toBe(true);
		await app.visit('/three');
		expect(leaves[1].isDestroyed).toBe(true);
		expect(leaves).toHaveLength(3);
		expect(parent.isDestroyed).toBe(false);
		expect(app.find('.parent')).toBeNull();
		layout.setData({ open: true });
		await settled();
		expect(app.find('.parent')).toBe(root);
		expect(app.findAll('.leaf')).toHaveLength(1);
		expect(app.find('.leaf')).toBe(leaves[2].element);
		expect(app.find('.leaf').textContent).toBe('/three');
		app.destroy();
		expect(parent.isDestroyed).toBe(true);
		expect(leaves.every((leaf) => leaf.isDestroyed)).toBe(true);
	});

	it('owns preloaded children when the first render has no outlet', async () => {
		let layout;
		const pages = [];
		class Page extends PuzzleView {
			created() { pages.push(this); }
			render() { return h('puzzle-view', { class: 'page' }, [text(this.route.pathname)]); }
		}
		class Layout extends PuzzleView {
			created() { layout = this; }
			render() { return h('puzzle-view', {}, this.getData().open ? [h(SLOT_TAG)] : []); }
		}
		const app = await createTestApp({ routes: [
			{ path: '/', layout: Layout, view: Page }, { path: '/two', layout: Layout, view: Page },
		] });
		handles.push(app);
		await app.visit('/two');
		expect(pages[0].isDestroyed).toBe(true);
		expect(pages[1].element).toBeNull();
		layout.setData({ open: true });
		await settled();
		expect(app.findAll('.page')).toHaveLength(1);
		expect(app.find('.page')).toBe(pages[1].element);
		app.destroy();
		expect(pages.every((page) => page.isDestroyed)).toBe(true);
	});

	it('moves a routed root between wrappers without destroying the newly adopted position', async () => {
		let layout;
		const pages = [];
		class Page extends PuzzleView {
			created() { pages.push(this); }
			render() { return h('puzzle-view', { class: 'page' }); }
		}
		class Wrapper extends PuzzleView {
			render() { return h('section', {}, [h(SLOT_TAG)]); }
		}
		class Layout extends PuzzleView {
			created() { layout = this; }
			render() {
				return h('puzzle-view', {}, this.getData().right
					? [h(Wrapper, { key: 'new' }, [h(SLOT_TAG)]), h('aside')]
					: [h('aside'), h(Wrapper, { key: 'old' }, [h(SLOT_TAG)])]);
			}
		}
		const app = await createTestApp({ routes: [{ path: '/', view: Page, layout: Layout }] });
		handles.push(app);
		const root = app.find('.page');
		layout.setData({ right: true });
		await settled();
		expect(app.findAll('.page')).toHaveLength(1);
		expect(app.find('.page')).toBe(root);
		expect(pages).toHaveLength(1);
		expect(pages[0].isDestroyed).toBe(false);
		expect(root.parentElement).toBe(app.find('section'));
	});

	it.each(['direct', 'element', 'component'])('retains the current view through a %s wrapper swap and navigation while hidden', async (wrapper) => {
		const calls = [];
		const pages = [];
		let layout;
		class Page extends PuzzleView {
			created() { pages.push(this); calls.push([this, 'created']); }
			mounted() { calls.push([this, 'mounted']); }
			viewWillShow() { calls.push([this, 'willShow']); }
			viewDidShow() { calls.push([this, 'didShow']); }
			viewWillHide() { calls.push([this, 'willHide']); }
			viewDidHide() { calls.push([this, 'didHide']); }
			destroyed() { calls.push([this, 'destroyed']); }
			render() { return h('puzzle-view', { class: 'page' }, [text(this.route.pathname), text(this.getData().label ?? '')]); }
		}
		class Other extends Page {}
		class Frame extends PuzzleView {
			render() { return h('section', { class: 'frame' }, [h(SLOT_TAG)]); }
		}
		class Layout extends PuzzleView {
			created() { layout = this; this.setData({ open: true }); }
			render() {
				const outlet = h(SLOT_TAG);
				const content = wrapper === 'direct' ? outlet : h(wrapper === 'component' ? Frame : 'section', { class: 'frame' }, [outlet]);
				return h('puzzle-view', { class: 'layout' }, [h('input', { key: 'before', class: 'before' }),
					...(this.getData().open ? [content] : [h('aside', { class: 'sign-in' }, [text('Sign in')])]),
					h('input', { key: 'after', class: 'after' })]);
			}
		}
		const app = await createTestApp({ routes: [
			{ path: '/', view: Page, layout: Layout },
			{ path: '/other', view: Other, layout: Layout },
		] });
		handles.push(app);
		const first = pages[0];
		const element = app.find('.page');
		const before = app.find('.before');
		const after = app.find('.after');
		const toggle = async (open) => { layout.setData({ open }); await settled(); };
		await toggle(false);
		expect(app.find('.page')).toBeNull();
		expect(first.isDestroyed).toBe(false);
		first.setData({ label: 'retained' });
		await settled();
		await toggle(true);
		expect(app.findAll('.page')).toHaveLength(1);
		expect(app.find('.page')).toBe(element);
		expect(element.textContent).toBe('/retained');
		expect(element.previousElementSibling).toBe(wrapper === 'direct' ? before : null);
		expect(app.find('.before')).toBe(before);
		expect(app.find('.after')).toBe(after);
		await toggle(false);
		await app.visit('/other');
		expect(first.isDestroyed).toBe(true);
		expect(app.find('.page')).toBeNull();
		await toggle(true);
		expect(app.findAll('.page')).toHaveLength(1);
		expect(app.find('.page').textContent).toBe('/other');
		expect(app.find('.page').parentElement).toBe(app.find(wrapper === 'direct' ? '.layout' : '.frame'));
		await toggle(false);
		app.destroy();
		expect(pages).toHaveLength(2);
		for (const page of pages) {
			expect(page.isDestroyed).toBe(true);
			expect(liveViewList()).not.toContain(page);
			const phases = calls.filter(([view]) => view === page).map(([, phase]) => phase);
			expect(phases.filter((phase) => phase === 'created')).toHaveLength(1);
			expect(phases.filter((phase) => phase === 'mounted')).toHaveLength(1);
			expect(phases.filter((phase) => phase === 'destroyed')).toHaveLength(1);
			expect(phases.filter((phase) => phase === 'willShow')).toHaveLength(1);
			expect(phases.filter((phase) => phase === 'didShow')).toHaveLength(1);
			expect(phases.filter((phase) => phase === 'willHide').length).toBe(phases.filter((phase) => phase === 'didHide').length);
		}
	});
});
