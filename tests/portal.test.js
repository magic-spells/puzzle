// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { PORTAL_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { setPortalHost, teardownPortals } from '../client-runtime/views/portal.js';
import { ViewManager, mount } from '../client-runtime/views/viewManager.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const portal = (children = []) => new ViewNode(PORTAL_TAG, {}, children);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const outlet = () => document.querySelector('[data-puzzle-portal]');
const outletHTML = () => outlet()?.innerHTML.replace(/<!--.*?-->/g, '') ?? null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	teardownPortals();
	delete globalThis.__PUZZLE_HAS_PORTAL__;
	document.body.replaceChildren();
});

describe('Portal (D144)', () => {
	it('mounts children into a lazily created outlet and leaves a placeholder locally', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		expect(outlet()).toBe(null);

		vm.render(h('div', {}, [text('local'), portal([h('p', { class: 'overlay' }, [text('remote')])])]));

		// Local position keeps a comment placeholder only.
		expect(host.querySelector('p.overlay')).toBe(null);
		expect(host.textContent).toBe('local');
		expect(host.firstChild.childNodes[1].nodeType).toBe(Node.COMMENT_NODE);

		// The outlet is a sibling of the mount container.
		expect(outlet().parentNode).toBe(host.parentNode);
		expect(outletHTML()).toBe('<p class="overlay">remote</p>');
	});

	it('patches portal children against the outlet range', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(h('div', {}, [portal([h('p', {}, [text('one')])])]));
		vm.render(h('div', {}, [portal([h('p', { class: 'x' }, [text('two')]), h('span', {}, [text('added')])])]));

		expect(outletHTML()).toBe('<p class="x">two</p><span>added</span>');
		// Patched, not remounted: one outlet, one range.
		expect(document.querySelectorAll('[data-puzzle-portal]').length).toBe(1);
	});

	it('keeps multiple portals in their own bracketed ranges', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(
			h('div', {}, [
				portal([h('p', { class: 'a' }, [text('A')])]),
				portal([h('p', { class: 'b' }, [text('B')])]),
			])
		);
		expect(outletHTML()).toBe('<p class="a">A</p><p class="b">B</p>');

		// A later child appended to the FIRST portal must land inside its own range.
		vm.render(
			h('div', {}, [
				portal([h('p', { class: 'a' }, [text('A')]), h('i', {}, [text('a2')])]),
				portal([h('p', { class: 'b' }, [text('B')])]),
			])
		);
		expect(outletHTML()).toBe('<p class="a">A</p><i>a2</i><p class="b">B</p>');
	});

	it('removes remote children and the outlet when the portal unmounts', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(h('div', {}, [portal([h('p', {}, [text('remote')])])]));
		expect(outletHTML()).toBe('<p>remote</p>');

		vm.render(h('div', {}, [h('span', {}, [text('gone')])]));
		expect(outlet()).toBe(null);
		expect(document.body.textContent).toBe('gone');
	});

	it('destroys portaled component instances on teardown (no leaked subscriptions)', async () => {
		const destroyed = [];
		class Overlay extends PuzzleView {
			render() {
				return h('div', { class: 'panel' }, [text('panel')]);
			}
			destroyed() {
				destroyed.push('overlay');
			}
		}

		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(h('div', {}, [portal([comp(Overlay)])]));
		await tick();
		expect(outlet().querySelector('.panel')).not.toBe(null);

		vm.clear();
		await tick();
		expect(destroyed).toEqual(['overlay']);
		expect(outlet()).toBe(null);
	});

	it('tears down a portal nested inside a removed subtree', async () => {
		const destroyed = [];
		class Overlay extends PuzzleView {
			render() {
				return h('div', { class: 'panel' }, [text('panel')]);
			}
			destroyed() {
				destroyed.push('overlay');
			}
		}

		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(h('div', {}, [h('section', {}, [portal([comp(Overlay)])])]));
		await tick();
		expect(outlet().querySelector('.panel')).not.toBe(null);

		// The whole <section> is replaced — the portal is not under its el, so the
		// removal must reach the remote children explicitly.
		vm.render(h('div', {}, [h('article', {}, [text('other')])]));
		await tick();
		expect(destroyed).toEqual(['overlay']);
		expect(outlet()).toBe(null);
	});

	it('tears down a portal removed from a keyed list', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		const row = (id, label) => h('li', { key: id }, [portal([h('p', {}, [text(label)])])]);
		vm.render(h('ul', {}, [row(1, 'one'), row(2, 'two')]));
		expect(outletHTML()).toBe('<p>one</p><p>two</p>');

		vm.render(h('ul', {}, [row(2, 'two')]));
		expect(outletHTML()).toBe('<p>two</p>');
	});

	it('detaches document-level `outside` listeners of portaled content on teardown', () => {
		const removeSpy = vi.spyOn(document, 'removeEventListener');
		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(h('div', {}, [portal([h('p', { '@click:outside': () => {} }, [text('x')])])]));
		vm.clear();
		expect(removeSpy.mock.calls.some(([type]) => type === 'click')).toBe(true);
		removeSpy.mockRestore();
	});

	it('treats a click inside portaled content as INSIDE the portaling element (@event:outside)', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		const outsideHits = [];
		vm.render(
			h('div', { class: 'menu', '@click:outside': () => outsideHits.push('menu') }, [
				portal([h('button', { class: 'remote' }, [text('remote')])]),
			])
		);

		// A click on the teleported button is logically inside the menu.
		outlet().querySelector('button.remote').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(outsideHits).toEqual([]);

		// A genuine outside click still fires.
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(outsideHits).toEqual(['menu']);
	});

	it('still reports outside for content portaled by an unrelated element', () => {
		const host = container();
		const vm = new ViewManager(host, {});
		const outsideHits = [];
		vm.render(
			h('div', {}, [
				h('div', { class: 'menu', '@click:outside': () => outsideHits.push('menu') }, [text('menu')]),
				h('div', { class: 'other' }, [portal([h('button', { class: 'remote' }, [text('r')])])]),
			])
		);

		outlet().querySelector('button.remote').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(outsideHits).toEqual(['menu']);
	});

	it('plays enter and leave animations for a portaled component', async () => {
		const played = [];
		class Overlay extends PuzzleView {
			animations = {
				in: { from: { opacity: 0 }, to: { opacity: 1 }, duration: 1 },
				out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 1 },
			};
			render() {
				return h('div', { class: 'panel' }, [text('panel')]);
			}
			viewDidShow() {
				played.push('in');
			}
			destroyed() {
				played.push('out');
			}
		}

		const host = container();
		const vm = new ViewManager(host, {});
		vm.render(h('div', {}, [portal([comp(Overlay)])]));
		await tick();
		expect(played).toContain('in');

		vm.render(h('div', {}, []));
		// Leave animation defers destroy(); wait for it to settle.
		for (let i = 0; i < 20 && !played.includes('out'); i++) await tick();
		expect(played).toContain('out');
		expect(outlet()?.querySelector('.panel') ?? null).toBe(null);
	});

	it('honours an explicit portal host', () => {
		const wrapper = document.createElement('section');
		document.body.appendChild(wrapper);
		setPortalHost(wrapper);
		const host = container();
		mount(portal([h('p', {}, [text('x')])]), host, null, {});
		expect(outlet().parentNode).toBe(wrapper);
	});

	it('warns once and renders inert when Portal support was compiled out', () => {
		globalThis.__PUZZLE_HAS_PORTAL__ = false;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const host = container();
		const vm = new ViewManager(host, {});

		expect(() =>
			vm.render(h('div', {}, [portal([h('p', { class: 'remote' }, [text('one')])])]))
		).not.toThrow();
		expect(outlet()).toBe(null);
		expect(host.querySelector('.remote')).toBe(null);
		expect(host.firstChild.firstChild.nodeType).toBe(Node.COMMENT_NODE);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('Portal support was compiled out');

		// Same-identity patches keep the inert placeholder; repeated encounters do
		// not spam, and teardown stays non-throwing.
		expect(() => vm.render(h('div', {}, [portal([h('p', {}, [text('two')])])]))).not.toThrow();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(() => vm.clear()).not.toThrow();
	});
});
